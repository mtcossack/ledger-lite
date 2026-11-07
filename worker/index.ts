/** Ledger Lite: isolated Cloudflare Worker + D1 shared ledger. No family data is bundled. */
interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type User = { id: string; email: string; display_name: string };
type StoredUser = User & { password_salt: string; password_hash: string; iterations: number };
type Person = { id: string; name: string; active: number; created_at: number };
type LedgerEntry = {
  id: string; person_id: string; category: 'money' | 'points' | 'screen'; delta: number;
  note: string; created_at: number; entered_by_name: string;
};
const COOKIE = 'ledger_session';
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED = 8;
const CATEGORIES = new Set(['money', 'points', 'screen']);
const DUMMY_SALT = 'YWJjZGVmZ2hpamtsbW5vcA'; // timing work for unknown users; not a credential
const DUMMY_HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const securityHeaders: Record<string,string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
};
function responseJson(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders, ...headers },
  });
}
function fail(status: number, message: string) { return responseJson({ error: message }, status); }
function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function sha256(value: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return base64Url(hash);
}
async function passwordMatches(password: string, salt: string, hash: string, iterations: number): Promise<boolean> {
  try {
    if (iterations < 100_000 || iterations > 1_000_000) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const candidate = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromBase64Url(salt), iterations, hash: 'SHA-256' }, key, 256));
    const expected = fromBase64Url(hash);
    if (candidate.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < candidate.length; i++) diff |= candidate[i] ^ expected[i];
    return diff === 0;
  } catch { return false; }
}
function getCookie(request: Request): string | null {
  const value = request.headers.get('cookie') ?? '';
  const match = value.match(/(?:^|;\s*)ledger_session=([A-Za-z0-9_-]{43})/);
  return match ? match[1] : null;
}
async function signedInUser(request: Request, env: Env): Promise<User | null> {
  const cookie = getCookie(request);
  if (!cookie) return null;
  const tokenHash = await sha256(cookie);
  return await env.DB.prepare(`SELECT u.id, u.email, u.display_name
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(tokenHash, Date.now()).first<User>();
}
function cookieHeader(token: string, maxAge: number): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  return !!origin && origin === new URL(request.url).origin && (!fetchSite || fetchSite === 'same-origin');
}
async function bodyObject(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return null;
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 8192) return null;
  const text = await request.text();
  if (text.length > 8192) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
function validName(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length >= 1 && input.trim().length <= 60 && !/[\u0000-\u001F\u007F]/.test(input);
}
async function login(request: Request, env: Env): Promise<Response> {
  const body = await bodyObject(request);
  if (!body) return fail(400, 'Invalid request');
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (email.length > 254 || password.length > 256 || !email.includes('@') || !password) return fail(400, 'Invalid request');

  // Rate limit by username+IP. Database holds only a hash of this combination.
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = await sha256(`${email}|${ip}`);
  const now = Date.now();
  const attempt = await env.DB.prepare('SELECT failures, last_failed_at FROM login_attempts WHERE key=?')
    .bind(key).first<{failures: number; last_failed_at: number}>();
  if (attempt && attempt.last_failed_at > now - WINDOW_MS && attempt.failures >= MAX_FAILED)
    return fail(429, 'Too many login attempts. Try again later.');

  const stored = await env.DB.prepare(`SELECT id,email,display_name,password_salt,password_hash,iterations
    FROM users WHERE email=?`).bind(email).first<StoredUser>();
  const matched = await passwordMatches(password, stored?.password_salt || DUMMY_SALT,
    stored?.password_hash || DUMMY_HASH, stored?.iterations || 600_000);
  if (!stored || !matched) {
    await env.DB.prepare(`INSERT INTO login_attempts (key, failures, last_failed_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN login_attempts.last_failed_at < ? THEN 1 ELSE login_attempts.failures+1 END,
      last_failed_at=excluded.last_failed_at`).bind(key, now, now - WINDOW_MS).run();
    return fail(401, 'Invalid email or password');
  }
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Url(tokenBytes);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE key=?').bind(key),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256(token), stored.id, now + SESSION_MS),
  ]);
  return responseJson({ user: { id: stored.id, email: stored.email, name: stored.display_name } },
    200, { 'set-cookie': cookieHeader(token, SESSION_MS / 1000) });
}
async function logout(request: Request, env: Env): Promise<Response> {
  const token = getCookie(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
  return responseJson({ ok: true }, 200, { 'set-cookie': cookieHeader('', 0) });
}
async function getState(env: Env, user: User): Promise<Response> {
  const [peopleResult, balancesResult, entriesResult] = await Promise.all([
    env.DB.prepare('SELECT id, name, active, created_at FROM people ORDER BY created_at, name').all<Person>(),
    env.DB.prepare('SELECT person_id, category, SUM(delta) AS balance FROM entries GROUP BY person_id, category')
      .all<{person_id: string;category: string;balance: number}>(),
    env.DB.prepare(`SELECT e.id,e.person_id,e.category,e.delta,e.note,e.created_at,
      u.display_name AS entered_by_name FROM entries e JOIN users u ON u.id=e.entered_by
      ORDER BY e.created_at DESC, e.id DESC LIMIT 300`).all<LedgerEntry>(),
  ]);
  return responseJson({
    user: { id: user.id, email: user.email, name: user.display_name },
    people: peopleResult.results,
    balances: balancesResult.results,
    entries: entriesResult.results,
  });
}
async function addPerson(request: Request, env: Env): Promise<Response> {
  const body = await bodyObject(request);
  if (!body || !validName(body.name)) return fail(400, 'Enter a name (1–60 characters)');
  const name = (body.name as string).trim();
  try {
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO people (id,name,created_at) VALUES (?,?,?)')
      .bind(id, name, Date.now()).run();
    return responseJson({ ok: true, id }, 201);
  } catch { return fail(409, 'That name may already exist'); }
}
async function updatePerson(request: Request, env: Env, id: string): Promise<Response> {
  const body = await bodyObject(request);
  if (!body || !validName(body.name)) return fail(400, 'Enter a valid name');
  const name = (body.name as string).trim();
  try {
    const result = await env.DB.prepare('UPDATE people SET name=? WHERE id=?').bind(name, id).run();
    if (!result.meta.changes) return fail(404, 'Person not found');
    return responseJson({ ok: true });
  } catch { return fail(409, 'That name may already exist'); }
}
async function addEntry(request: Request, env: Env, user: User): Promise<Response> {
  const body = await bodyObject(request);
  if (!body) return fail(400, 'Invalid request');
  const personId = body.personId;
  const category = body.category;
  const delta = body.delta;
  const note = body.note;
  if (typeof personId !== 'string' || personId.length > 64 ||
    typeof category !== 'string' || !CATEGORIES.has(category) ||
    typeof delta !== 'number' || !Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 100_000_000 ||
    typeof note !== 'string' || note.trim().length < 2 || note.trim().length > 180 || /[\u0000-\u001F\u007F]/.test(note))
    return fail(400, 'Check the person, category, amount, and note');
  const person = await env.DB.prepare('SELECT id FROM people WHERE id=? AND active=1').bind(personId).first<{id: string}>();
  if (!person) return fail(404, 'Person not found');
  await env.DB.prepare(`INSERT INTO entries (id,person_id,category,delta,note,entered_by,created_at)
    VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),personId,category,delta,note.trim(),user.id,Date.now()).run();
  return responseJson({ ok: true }, 201);
}
function csvCell(value: string | number): string {
  let v = String(value);
  // Guard against CSV / spreadsheet formula injection from user-entered text.
  if (/^[\s]*[=+\-@\t\r]/.test(v) && typeof value === 'string') v = `'${v}`;
  return '"' + v.replace(/"/g, '""') + '"';
}
async function exportCsv(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`SELECT e.created_at,p.name AS person,e.category,e.delta,e.note,
    u.display_name AS author FROM entries e JOIN people p ON e.person_id=p.id
    JOIN users u ON e.entered_by=u.id ORDER BY e.created_at DESC`).all<{
    created_at: number;person:string;category:string;delta:number;note:string;author:string;
  }>();
  const rows: Array<Array<string | number>> = [['Date (UTC)','Person','Category','Change','Note','Added by']];
  for (const item of result.results) rows.push([
    new Date(item.created_at).toISOString(), item.person, item.category,
    item.category === 'money' ? item.delta / 100 : item.delta,
    item.note, item.author,
  ]);
  return new Response('\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),{
    headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="ledger-lite-export.csv"',
      'cache-control':'no-store',...securityHeaders},
  });
}
async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (!['GET','POST','PATCH'].includes(request.method)) return fail(405, 'Method not allowed');
  if (request.method !== 'GET' && !sameOrigin(request)) return fail(403, 'Origin rejected');
  if (path === '/api/login' && request.method === 'POST') return login(request, env);
  if (path === '/api/logout' && request.method === 'POST') return logout(request, env);
  const user = await signedInUser(request, env);
  if (!user) return fail(401, 'Please sign in');
  if (path === '/api/state' && request.method === 'GET') return getState(env, user);
  if (path === '/api/people' && request.method === 'POST') return addPerson(request, env);
  const personMatch = path.match(/^\/api\/people\/([0-9a-f-]{36})$/);
  if (personMatch && request.method === 'PATCH') return updatePerson(request, env, personMatch[1]);
  if (path === '/api/entries' && request.method === 'POST') return addEntry(request, env, user);
  if (path === '/api/export' && request.method === 'GET') return exportCsv(env);
  return fail(404, 'Not found');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const {pathname} = new URL(request.url);
      if (pathname.startsWith('/api/')) return await handleApi(request, env, pathname);
      if (!['GET','HEAD'].includes(request.method)) return fail(405,'Method not allowed');
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      for (const [k,v] of Object.entries(securityHeaders)) headers.set(k,v);
      if (pathname === '/' || pathname.endsWith('.html')) headers.set('cache-control','no-store');
      return new Response(asset.body,{status:asset.status, statusText:asset.statusText, headers});
    } catch (error) {
      console.error('Ledger Lite request failed', error instanceof Error ? error.message : 'unknown');
      return fail(500, 'Server error. Check the deployment and database configuration.');
    }
  },
} satisfies ExportedHandler<Env>;

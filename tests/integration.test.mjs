import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes,randomUUID,pbkdf2Sync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const root = new URL('../',import.meta.url).pathname;

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args=[]; }
  bind(...args) { this.args=args; return this; }
  async first() { return this.db.prepare(this.sql).get(...this.args) || null; }
  async all() { return {results:this.db.prepare(this.sql).all(...this.args)}; }
  async run() {const result=this.db.prepare(this.sql).run(...this.args);return {meta:{changes:Number(result.changes)}};}
}
class MockD1 {
  constructor(db){this.db=db;}
  prepare(sql){return new Statement(this.db,sql);}
  async batch(statements){return Promise.all(statements.map(x=>x.run()));}
}

test('login, authentication, entries, CSV, cross-origin protection, logout', async () => {
  const out = await mkdtemp(join(tmpdir(),'ledger-lite-test-'));
  let db;
  try {
    execFileSync('tsc',['--project',join(root,'tsconfig.json'),'--noEmit','false','--outDir',out],{stdio:'pipe'});
    // The temporary JavaScript output is an ESM module.
    const workerPath = join(out,'index.js');
    await (await import('node:fs/promises')).writeFile(join(out,'package.json'),'{"type":"module"}\n');
    const worker = (await import(pathToFileURL(workerPath).href)).default;
    db = new DatabaseSync(':memory:');
    db.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
    const salt = randomBytes(16);
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(
      randomUUID(),'adult@example.com','Test Adult',salt.toString('base64url'),
      pbkdf2Sync('TestPassword1234!',salt,600_000,32,'sha256').toString('base64url'),600_000,Date.now(),
    );
    const env = {DB:new MockD1(db),ASSETS:{fetch:async()=>new Response('asset')}};
    const req = (path,method='GET',data, cookie, origin='https://ledger.example') => new Request('https://ledger.example'+path,{
      method, headers:{...(cookie ? {cookie}:{ }),...(data ? {'content-type':'application/json',origin}:{})},
      ...(data ? {body:JSON.stringify(data)} : {}),
    });
    const unauth = await worker.fetch(req('/api/state'),env);
    assert.equal(unauth.status,401);
    const rejected = await worker.fetch(req('/api/people','POST',{name:'Child One'},undefined,'https://attacker.example'),env);
    assert.equal(rejected.status,403);
    const bad = await worker.fetch(req('/api/login','POST',{email:'adult@example.com',password:'wrong'}),env);
    assert.equal(bad.status,401);
    const login = await worker.fetch(req('/api/login','POST',{email:'adult@example.com',password:'TestPassword1234!'}),env);
    assert.equal(login.status,200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie,/ledger_session=/);
    assert.match(login.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
    const person = await worker.fetch(req('/api/people','POST',{name:'Child One'},cookie),env);
    assert.equal(person.status,201);
    const personId = (await person.json()).id;
    const entry = await worker.fetch(req('/api/entries','POST',{personId,category:'money',delta:1250,note:'Allowance'},cookie),env);
    assert.equal(entry.status,201);
    const state = await worker.fetch(req('/api/state','GET',undefined,cookie),env);
    assert.equal(state.status,200);
    const body = await state.json();
    assert.equal(body.people.length,1);
    assert.equal(body.balances[0].balance,1250);
    assert.equal(body.entries[0].note,'Allowance');
    assert.equal((await worker.fetch(req('/api/export','GET',undefined),env)).status,401);
    const csv = await worker.fetch(req('/api/export','GET',undefined,cookie),env);
    assert.equal(csv.status,200);
    assert.match(await csv.text(),/Allowance/);
    const logout = await worker.fetch(req('/api/logout','POST',{},cookie),env);
    assert.equal(logout.status,200);
    assert.equal((await worker.fetch(req('/api/state','GET',undefined,cookie),env)).status,401);
  } finally {
    db?.close();
    await rm(out,{recursive:true,force:true});
  }
});

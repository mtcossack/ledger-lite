import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const read = path => readFile(new URL(`../${path}`,import.meta.url),'utf8');
test('private API routes require a signed-in user', async () => {
  const worker = await read('worker/index.ts');
  assert.match(worker,/const user = await signedInUser\(request, env\);/);
  assert.match(worker,/if \(!user\) return fail\(401, 'Please sign in'\)/);
  assert.match(worker,/sameOrigin\(request\)/);
  assert.match(worker,/HttpOnly; Secure; SameSite=Strict/);
});
test('stateful files are excluded from git', async () => {
  const ignore = await read('.gitignore');
  for(const path of ['.local/','.env','.dev.vars','.wrangler/']) assert.ok(ignore.includes(path));
  const schema = await read('schema.sql');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS sessions/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS entries/);
});
test('starter has no starter family or ledger records', async () => {
  const schema = await read('schema.sql');
  assert.doesNotMatch(schema,/INSERT INTO (users|people|entries)/i);
  const frontend = await read('public/app.js');
  assert.doesNotMatch(frontend,/localStorage|sessionStorage/);
});

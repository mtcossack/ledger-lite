#!/usr/bin/env node
/** Produces a local SQL file containing a salted PBKDF2 hash, never a plaintext password. */
import { randomBytes, randomUUID, pbkdf2Sync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
const ITERATIONS = 600_000;
const sql = value => `'${value.replaceAll("'", "''")}'`;
const b64url = bytes => Buffer.from(bytes).toString('base64url');

function passwordPrompt(message) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('Run this command in an interactive terminal so the password can be hidden.'));
      return;
    }
    let value = '';
    const restore = () => { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    const onData = chunk => {
      for (const key of String(chunk)) {
        if (key === '\r' || key === '\n') { restore(); resolve(value); return; }
        if (key === '\u0003') { restore(); reject(new Error('Cancelled')); return; }
        if (key === '\u007f' || key === '\b') { value = value.slice(0,-1); continue; }
        if (key >= ' ' && value.length < 256) value += key;
      }
    };
    stdout.write(message);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data',onData);
  });
}

try {
  const rl = createInterface({input:stdin,output:stdout});
  const name = (await rl.question('Adult display name: ')).trim();
  const email = (await rl.question('Adult email: ')).trim().toLowerCase();
  rl.close();
  if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Invalid name');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email address');
  const password = await passwordPrompt('New password (12+ characters, hidden): ');
  const confirm = await passwordPrompt('Confirm password (hidden): ');
  if (password !== confirm) throw new Error('Passwords did not match');
  if (password.length < 12) throw new Error('Use at least 12 characters');
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  const statements = [
    `INSERT INTO users (id,email,display_name,password_salt,password_hash,iterations,created_at) VALUES (${sql(randomUUID())},${sql(email)},${sql(name)},${sql(b64url(salt))},${sql(b64url(hash))},${ITERATIONS},${Date.now()}) ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,password_salt=excluded.password_salt,password_hash=excluded.password_hash,iterations=excluded.iterations;`,
    `DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE email=${sql(email)});`,
  ];
  await mkdir('.local',{recursive:true,mode:0o700});
  await writeFile('.local/add-user.sql',statements.join('\n')+'\n',{mode:0o600});
  stdout.write('\nCreated .local/add-user.sql (salted hash; no plaintext password).\n');
  stdout.write('For DEPLOYED database: npx wrangler d1 execute ledger-lite-db --remote --file=./.local/add-user.sql\n');
  stdout.write('For LOCAL development:  npx wrangler d1 execute ledger-lite-db --local --file=./.local/add-user.sql\n');
  stdout.write('Run one of those commands now, then run npm run user:add again for the second adult.\n');
} catch (error) {
  console.error('Setup failed:',error.message);
  process.exitCode = 1;
}

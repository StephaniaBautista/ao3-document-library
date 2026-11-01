import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleAdultDeclaration } from '../lib/catalog/age-declaration.ts';

function fixture() {
 const raw = new DatabaseSync(':memory:');
 raw.exec("CREATE TABLE user (id TEXT PRIMARY KEY, email_verified INTEGER NOT NULL); CREATE TABLE library_profiles (user_id TEXT PRIMARY KEY, blocked INTEGER NOT NULL DEFAULT 0, age_verified INTEGER NOT NULL DEFAULT 0, age_verification_state TEXT DEFAULT 'pending', age_verification_next_check_at INTEGER, created_at INTEGER NOT NULL)");
 raw.prepare('INSERT INTO user VALUES (?, ?)').run('adult', 1);
 raw.prepare('INSERT INTO user VALUES (?, ?)').run('unverified', 0);
 raw.prepare('INSERT INTO user VALUES (?, ?)').run('blocked', 1);
 raw.prepare('INSERT INTO library_profiles (user_id, blocked, created_at) VALUES (?, 1, 0)').run('blocked');
 const db = { prepare(sql) { return { bind(...values) { return { run: async () => raw.prepare(sql).run(...values), first: async () => raw.prepare(sql).get(...values) ?? null }; } }; } };
 return { raw, db };
}
function request(body, origin = 'https://library.test') {
 return new Request('https://library.test/api/age-verification', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('records an explicit self-declaration for the authenticated verified account', async () => {
 const { raw, db } = fixture();
 try {
  const user = async () => ({ id: 'adult', emailVerified: true });
  const res = await handleAdultDeclaration(request({ confirmed: true, userId: 'blocked' }), user, db);
  assert.equal(res.status, 200);
  assert.deepEqual({ ...raw.prepare('SELECT age_verified, age_verification_state FROM library_profiles WHERE user_id = ?').get('adult') }, { age_verified: 1, age_verification_state: 'self_declared' });
  assert.equal(raw.prepare('SELECT age_verified FROM library_profiles WHERE user_id = ?').get('blocked').age_verified, 0);
  assert.equal((await handleAdultDeclaration(request({ confirmed: true }), user, db)).status, 200);
 } finally { raw.close(); }
});

test('requires same origin, verified email, explicit confirmation and an unblocked account', async () => {
 const { raw, db } = fixture();
 try {
  const user = async () => ({ id: 'adult', emailVerified: true });
  assert.equal((await handleAdultDeclaration(request({ confirmed: true }, 'https://other.test'), user, db)).status, 403);
  assert.equal((await handleAdultDeclaration(request({ confirmed: true }), async () => null, db)).status, 401);
  assert.equal((await handleAdultDeclaration(request({ confirmed: true }), async () => ({ id: 'unverified', emailVerified: false }), db)).status, 401);
  assert.equal((await handleAdultDeclaration(request({ confirmed: true }), async () => ({ id: 'unverified', emailVerified: true }), db)).status, 403);
  assert.equal((await handleAdultDeclaration(request({ confirmed: true }), async () => ({ id: 'blocked', emailVerified: true }), db)).status, 403);
  for (const body of [{}, { confirmed: false }, { confirmed: 'true' }]) assert.equal((await handleAdultDeclaration(request(body), user, db)).status, 400);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM library_profiles WHERE user_id = ?').get('adult').n, 0);
 } finally { raw.close(); }
});

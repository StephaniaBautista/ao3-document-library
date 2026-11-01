import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { revokeDriveConnection } from '../lib/catalog/revoke-drive.mjs';

function fixture() {
 const raw = new DatabaseSync(':memory:');
 raw.exec('CREATE TABLE private_drive_connections(user_id TEXT PRIMARY KEY, refresh_token_ciphertext TEXT NOT NULL); CREATE TABLE drive_connections(user_id TEXT PRIMARY KEY, refresh_token_ciphertext TEXT NOT NULL);');
 raw.prepare('INSERT INTO private_drive_connections VALUES (?,?)').run('u', 'encrypted-token');
 const db = { prepare(sql) { return { bind(...args) { return { first: async () => raw.prepare(sql).get(...args), run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }) }; } }; } };
 return { raw, db };
}
const decrypt = async () => 'synthetic-refresh-token';
test('revokes the private token before removing it', async () => {
 const { raw, db } = fixture();
 try {
  await revokeDriveConnection(db, 'u', 'private', decrypt, async (url, options) => {
   assert.equal(url, 'https://oauth2.googleapis.com/revoke'); assert.equal(options.redirect, 'manual');
   assert.equal(new URLSearchParams(options.body).get('token'), 'synthetic-refresh-token');
   assert.equal(raw.prepare('SELECT count(*) AS n FROM private_drive_connections').get().n, 1);
   return new Response(null, { status: 200 });
  });
  assert.equal(raw.prepare('SELECT count(*) AS n FROM private_drive_connections').get().n, 0);
 } finally { raw.close(); }
});

test('preserves the stored credential on network failure or provider rejection', async () => {
 const { raw, db } = fixture();
 try {
  await assert.rejects(revokeDriveConnection(db, 'u', 'private', decrypt, async () => { throw new Error('offline'); }));
  await assert.rejects(revokeDriveConnection(db, 'u', 'private', decrypt, async () => new Response(null, { status: 503 })));
  assert.equal(raw.prepare('SELECT count(*) AS n FROM private_drive_connections').get().n, 1);
 } finally { raw.close(); }
});

test('already revoked tokens are removed, but a concurrently replaced token is not', async () => {
 const { raw, db } = fixture();
 try {
  await assert.rejects(revokeDriveConnection(db, 'u', 'private', decrypt, async () => { raw.prepare('UPDATE private_drive_connections SET refresh_token_ciphertext = ? WHERE user_id = ?').run('new-token', 'u'); return new Response(null, { status: 200 }); }), /changed/);
  assert.equal(raw.prepare('SELECT refresh_token_ciphertext AS token FROM private_drive_connections').get().token, 'new-token');
  await revokeDriveConnection(db, 'u', 'private', decrypt, async () => Response.json({ error: 'invalid_token' }, { status: 400 }));
  assert.equal(raw.prepare('SELECT count(*) AS n FROM private_drive_connections').get().n, 0);
 } finally { raw.close(); }
});

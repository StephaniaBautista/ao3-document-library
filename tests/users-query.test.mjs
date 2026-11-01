import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { listAdminUsers, parseUserCursor } from '../lib/catalog/users-query.ts';

function fixture() {
 const raw = new DatabaseSync(':memory:');
 const directory = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, directory), 'utf8'));
 const insert = raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)');
 for (let i = 0; i < 620; i++) insert.run(`u${String(i).padStart(4, '0')}`, `User ${i}`, `u${i}@example.invalid`, 1, 1000 + Math.floor(i / 3), 1);
 const db = { prepare: sql => ({ bind: (...values) => ({ all: async () => ({ results: raw.prepare(sql).all(...values) }) }) }) };
 return { raw, db, insert };
}

test('all users remain reachable with stable pagination even when creation times match', async () => {
 const { raw, db, insert } = fixture();
 try {
  const seen = []; let cursor = null, pages = 0;
  do {
   const result = await listAdminUsers(db, '', cursor);
   seen.push(...result.users.map(user => user.id)); cursor = result.nextCursor; pages++;
   if (pages === 1) insert.run('newer', 'New user', 'new@example.invalid', 1, 9999, 1);
  } while (cursor);
  assert.equal(seen.length, 620);
  assert.equal(new Set(seen).size, 620);
  assert.ok(seen.includes('u0000') && seen.includes('u0619'));
  assert.ok(!seen.includes('newer'));
 } finally { raw.close(); }
});

test('search treats SQL wildcards literally and validates page cursors', async () => {
 const { raw, db, insert } = fixture();
 try {
  insert.run('special', '100%_valid\\name', 'special@example.invalid', 1, 1, 1);
  const result = await listAdminUsers(db, '%_valid\\', null);
  assert.deepEqual(result.users.map(user => user.id), ['special']);
  assert.deepEqual(parseUserCursor('1000', 'u0000'), { createdAt: 1000, id: 'u0000' });
  assert.equal(parseUserCursor(null, null), null);
  for (const [time, id] of [['1', null], ['-1', 'u'], ['9007199254740992', 'u'], ['1', 'bad\nid']]) assert.equal(parseUserCursor(time, id), false);
 } finally { raw.close(); }
});

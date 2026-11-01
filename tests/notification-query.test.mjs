import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { listNotificationIssues } from '../lib/catalog/notification-query.ts';

test('all unresolved notifications remain reachable after earlier items are resolved', async () => {
 const raw = new DatabaseSync(':memory:');
 const directory = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, directory), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u', 'User', 'u@example.invalid', 1, 1, 1);
 const add = raw.prepare('INSERT INTO notification_batches (id,user_id,recovery_at,state,created_at) VALUES (?,?,?,?,?)');
 for (let i = 0; i < 180; i++) add.run(`b${String(i).padStart(3, '0')}`, 'u', i, ['failed', 'unknown', 'sending'][i % 3], 1000 + Math.floor(i / 4));
 add.run('not-an-issue', 'u', 999, 'sent', 1);
 const db = { prepare: sql => ({ bind: (...values) => ({ all: async () => ({ results: raw.prepare(sql).all(...values) }) }) }) };
 try {
  const seen = []; let cursor = null, pages = 0;
  do {
   const result = await listNotificationIssues(db, cursor);
   seen.push(...result.notifications.map(row => row.id)); cursor = result.nextCursor; pages++;
   if (pages === 1) raw.prepare("UPDATE notification_batches SET state = 'sent' WHERE id = 'b010'").run();
  } while (cursor);
  assert.equal(pages, 4); assert.equal(seen.length, 180); assert.equal(new Set(seen).size, 180);
  assert.equal(seen[0], 'b000'); assert.equal(seen.at(-1), 'b179');
 } finally { raw.close(); }
});

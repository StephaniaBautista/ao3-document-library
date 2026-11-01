import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { listReminders } from '../lib/catalog/reminder-query.ts';

test('personal reminders stay private and reachable across pages with equal timestamps and deletions', async () => {
 const raw = new DatabaseSync(':memory:');
 const directory = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, directory), 'utf8'));
 const addUser = raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)');
 addUser.run('u','User','u@example.invalid',1,1,1); addUser.run('other','Other','other@example.invalid',1,1,1);
 raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)').run('s','s.pdf','pdf',1,'key','hash','Story',1);
 const add = raw.prepare('INSERT INTO reminders (id,user_id,story_id,action,comment,created_at) VALUES (?,?,?,?,?,?)');
 for (let i = 0; i < 180; i++) add.run(`r${String(i).padStart(3, '0')}`, 'u', 's', 'comment', `Comment ${i}`, 1000 + Math.floor(i / 4));
 add.run('private', 'other', 's', 'comment', 'Someone else', 9999);
 const db = { prepare: sql => ({ bind: (...values) => ({ all: async () => ({ results: raw.prepare(sql).all(...values) }) }) }) };
 try {
  const seen = []; let cursor = null, pages = 0;
  do {
   const result = await listReminders(db, 'u', cursor);
   seen.push(...result.reminders.map(row => row.id)); cursor = result.nextCursor; pages++;
   if (pages === 1) raw.prepare('DELETE FROM reminders WHERE id = ?').run(seen[10]);
  } while (cursor);
  assert.equal(pages, 4); assert.equal(seen.length, 180); assert.equal(new Set(seen).size, 180);
  assert.ok(!seen.includes('private'));
  assert.deepEqual((await listReminders(db, 'other', null)).reminders.map(row => row.id), ['private']);
 } finally { raw.close(); }
});

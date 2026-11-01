import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { listDriveFailures, parseFailureCursor } from '../lib/catalog/drive-failures.ts';

test('all import failures are reachable, scoped to the job, and identify their folder paths', async () => {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const dir = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, dir), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','Admin','u@example.invalid',1,1,1);
 const job = raw.prepare('INSERT INTO drive_import_jobs (id,user_id,created_at) VALUES (?,?,?)'); job.run('j','u',1); job.run('other','u',1);
 const item = raw.prepare('INSERT INTO drive_import_items (id,job_id,drive_id,name,mime_type,parent_item_id,state,error,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
 item.run('root','j','root','Fandom','application/vnd.google-apps.folder',null,'done',null,1);
 item.run('parent-a','j','a','Pareja A','application/vnd.google-apps.folder','root','done',null,1);
 item.run('parent-b','j','b','Pareja B','application/vnd.google-apps.folder','root','done',null,1);
 for (let i = 0; i < 180; i++) item.run(`f${String(i).padStart(3,'0')}`,'j',`file${i}`,'Story.pdf','application/pdf',i % 2 ? 'parent-a' : 'parent-b','failed','No access',1);
 item.run('other-failure','other','otherfile','Private.pdf','application/pdf',null,'failed','No access',1);
 const db = { prepare: sql => ({ bind: (...values) => ({ all: async () => ({ results: raw.prepare(sql).all(...values) }) }) }) };
 try {
  const seen = []; let cursor = null, pages = 0;
  do {
   const result = await listDriveFailures(db, 'j', cursor);
   seen.push(...result.failures); cursor = result.nextFailureCursor; pages++;
   if (pages === 1) raw.prepare("UPDATE drive_import_items SET state = 'pending' WHERE id = 'f010'").run();
  } while (cursor);
  assert.equal(pages, 4); assert.equal(seen.length, 180); assert.equal(new Set(seen.map(row => row.id)).size, 180);
  assert.equal(seen.find(row => row.id === 'f000').path, 'Fandom / Pareja B / Story.pdf');
  assert.equal(seen.find(row => row.id === 'f001').path, 'Fandom / Pareja A / Story.pdf');
  assert.ok(!seen.some(row => row.id === 'other-failure'));
  assert.equal(parseFailureCursor(null), null); assert.equal(parseFailureCursor('f001'), 'f001');
  for (const invalid of ['', 'bad\nid', 'a/b', 'x'.repeat(257)]) assert.equal(parseFailureCursor(invalid), false);
 } finally { raw.close(); }
});

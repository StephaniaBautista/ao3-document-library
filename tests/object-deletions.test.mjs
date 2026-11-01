import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { approveRemoval, flushObjectDeletion, processObjectDeletions, removeStory } from '../lib/catalog/object-deletions.ts';

function fixture() {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const directory = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, directory), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','User','test@example.invalid',1,1,1);
 raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)').run('s','s.pdf','pdf',1,'catalog/s','hash','Story',1);
 function prepare(sql) { function bound(values) { const execute = () => { const result = raw.prepare(sql).run(...values); return { meta: { changes: result.changes } }; }; return { bind: (...args) => bound(args), first: async () => raw.prepare(sql).get(...values) ?? null, all: async () => ({ results: raw.prepare(sql).all(...values) }), run: async () => execute(), execute }; } return bound([]); }
 const db = { prepare, batch: async statements => { raw.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); raw.exec('COMMIT'); return results; } catch (error) { raw.exec('ROLLBACK'); throw error; } } };
 return { raw, db };
}

test('database failure rolls back removal before touching the original', async () => {
 const { raw, db } = fixture();
 db.batch = async statements => { raw.exec('BEGIN'); try { statements[0].execute(); statements[1].execute(); throw new Error('database unavailable'); } catch (error) { raw.exec('ROLLBACK'); throw error; } };
 try {
  await assert.rejects(removeStory(db, 's'));
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 1);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM object_deletions').get().n, 0);
 } finally { raw.close(); }
});

test('storage failure keeps a deletion pending and a later worker retries it', async () => {
 const { raw, db } = fixture(); let attempts = 0;
 const bucket = { delete: async () => { if (++attempts === 1) throw new Error('temporary outage'); } };
 try {
  const key = await removeStory(db, 's'); assert.equal(key, 'catalog/s');
  assert.equal(await flushObjectDeletion(db, bucket, key), false);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 0);
  assert.equal(raw.prepare('SELECT deleted_at FROM object_deletions').get().deleted_at, null);
  await processObjectDeletions({ DB: db, BUCKET: bucket });
  assert.equal(attempts, 2);
  assert.ok(raw.prepare('SELECT deleted_at FROM object_deletions').get().deleted_at);
  assert.equal(await flushObjectDeletion(db, bucket, key), true);
  assert.equal(attempts, 2);
 } finally { raw.close(); }
});

test('a referenced object is never removed by a stale cleanup item', async () => {
 const { raw, db } = fixture(); let attempts = 0;
 raw.prepare('INSERT INTO object_deletions (object_key,queued_at) VALUES (?,?)').run('catalog/s', 1);
 try {
  assert.equal(await flushObjectDeletion(db, { delete: async () => { attempts++; } }, 'catalog/s'), false);
  assert.equal(attempts, 0);
 } finally { raw.close(); }
});

test('completed cleanup markers expire without keeping a moderation history', async () => {
 const { raw, db } = fixture();
 const now = Date.now();
 raw.prepare('INSERT INTO object_deletions (object_key,queued_at,deleted_at) VALUES (?,?,?)').run('old', now - 90_100_000, now - 90_000_001);
 raw.prepare('INSERT INTO object_deletions (object_key,queued_at,deleted_at) VALUES (?,?,?)').run('recent', now, now);
 try {
  await processObjectDeletions({ DB: db, BUCKET: { delete: async () => { throw new Error('not expected'); } } });
  assert.deepEqual(raw.prepare('SELECT object_key FROM object_deletions').all().map(row => row.object_key), ['recent']);
 } finally { raw.close(); }
});

test('permanent failures do not starve later pending deletions', async () => {
 const { raw, db } = fixture(); const removed = [];
 const insert = raw.prepare('INSERT INTO object_deletions (object_key,queued_at) VALUES (?,?)');
 for (let i = 1; i <= 26; i++) insert.run(`key-${i}`, i);
 const bucket = { delete: async key => { if (key !== 'key-26') throw new Error('unavailable'); removed.push(key); } };
 try {
  await processObjectDeletions({ DB: db, BUCKET: bucket });
  assert.deepEqual(removed, []);
  await processObjectDeletions({ DB: db, BUCKET: bucket });
  assert.deepEqual(removed, ['key-26']);
 } finally { raw.close(); }
});

test('approving a pending request removes its story and queues the object atomically', async () => {
 const { raw, db } = fixture();
 raw.prepare('INSERT INTO removal_requests (id,requester_id,story_id,story_description,proof,created_at) VALUES (?,?,?,?,?,?)').run('r','u','s','Story','Proof',1);
 try {
  assert.equal(await approveRemoval(db, 'r', 's'), 'catalog/s');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 0);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM removal_requests').get().n, 0);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM object_deletions WHERE deleted_at IS NULL').get().n, 1);
  assert.equal(await approveRemoval(db, 'r', 's'), null);
 } finally { raw.close(); }
});

test('approval cannot remove a different story when the request changes during review', async () => {
 const { raw, db } = fixture();
 raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)').run('s2','s2.pdf','pdf',1,'catalog/s2','hash2','Other story',1);
 raw.prepare('INSERT INTO removal_requests (id,requester_id,story_id,story_description,proof,created_at) VALUES (?,?,?,?,?,?)').run('r','u','s','Story','Proof',1);
 const prepare=db.prepare;
 db.prepare=sql => {
  const statement=prepare(sql);
  if (!sql.startsWith('SELECT s.object_key AS objectKey')) return statement;
  return { bind: (...values) => { const bound=statement.bind(...values); return { first:async () => { const result=await bound.first(); raw.prepare('UPDATE removal_requests SET story_id = ? WHERE id = ?').run('s2','r'); return result; } }; } };
 };
 try {
  assert.equal(await approveRemoval(db,'r','s'),null);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n,2);
  assert.equal(raw.prepare('SELECT story_id FROM removal_requests WHERE id = ?').get('r').story_id,'s2');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM object_deletions').get().n,0);
 } finally { raw.close(); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { listRemovalRequests } from '../lib/catalog/removal-query.ts';

test('all pending removal requests remain reachable when timestamps match and earlier requests are resolved', async () => {
 const raw = new DatabaseSync(':memory:');
 const directory = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, directory), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u', 'User', 'u@example.invalid', 1, 1, 1);
 const add = raw.prepare('INSERT INTO removal_requests (id,requester_id,story_description,proof,created_at) VALUES (?,?,?,?,?)');
 for (let i = 0; i < 180; i++) add.run(`r${String(i).padStart(3, '0')}`, 'u', `Story ${i}`, `Proof ${i}`, 1000 + Math.floor(i / 4));
 const db = { prepare: sql => ({ bind: (...values) => ({ all: async () => ({ results: raw.prepare(sql).all(...values) }) }) }) };
 try {
  const seen = []; let cursor = null, pages = 0;
  do {
   const result = await listRemovalRequests(db, cursor);
   seen.push(...result.requests.map(row => row.id)); cursor = result.nextCursor; pages++;
   if (pages === 1) raw.prepare('DELETE FROM removal_requests WHERE id = ?').run('r010');
  } while (cursor);
  assert.equal(pages, 4); assert.equal(seen.length, 180); assert.equal(new Set(seen).size, 180);
  assert.equal(seen[0], 'r000'); assert.equal(seen.at(-1), 'r179');
 } finally { raw.close(); }
});

test('review identifies the actual linked story even when the submitted description is misleading or the story is removed', async () => {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const directory = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, directory), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','User','u@example.invalid',1,1,1);
 raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,author,ao3_url,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('s','real.epub','epub',1,'key','hash','Real story','Real author','https://archiveofourown.org/works/123',1);
 raw.prepare('INSERT INTO removal_requests (id,requester_id,story_id,story_description,proof,created_at) VALUES (?,?,?,?,?,?)').run('r','u','s','Different story','Evidence link',1);
 const db = { prepare: sql => ({ bind: (...values) => ({ all: async () => ({ results: raw.prepare(sql).all(...values) }) }) }) };
 try {
  let request=(await listRemovalRequests(db,null)).requests[0];
  assert.deepEqual({storyId:request.storyId,storyTitle:request.storyTitle,storyFilename:request.storyFilename,storyAuthor:request.storyAuthor,storyAo3Url:request.storyAo3Url,description:request.storyDescription,proof:request.proof}, {storyId:'s',storyTitle:'Real story',storyFilename:'real.epub',storyAuthor:'Real author',storyAo3Url:'https://archiveofourown.org/works/123',description:'Different story',proof:'Evidence link'});
  raw.prepare('DELETE FROM shared_stories WHERE id = ?').run('s');
  request=(await listRemovalRequests(db,null)).requests[0];
  assert.equal(request.storyId,null); assert.equal(request.storyTitle,null); assert.equal(request.storyDescription,'Different story');
 } finally { raw.close(); }
});

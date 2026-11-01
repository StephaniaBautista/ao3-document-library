import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { buildStoryQuery } from '../lib/catalog/story-query.ts';
import { listReadingPositions, parseReadingFilters, readingFilterOptions } from '../lib/catalog/reading-query.ts';

function fixture() {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const dir = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, dir), 'utf8'));
 const db = { prepare: sql => ({ bind: (...values) => ({ all: async () => ({ results: raw.prepare(sql).all(...values) }) }) }) };
 return { raw, db };
}

test('catalog filters use literal searches, supported numeric ranges, and safe offset validation', () => {
 const { raw } = fixture();
 const add = raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,tags,word_count,chapter_count,total_chapters,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
 add.run('s1','one.pdf','pdf',1,'k1','h1','100%_true','Fluff',120,3,3,1);
 add.run('s2','two.pdf','pdf',1,'k2','h2','1000Xtrue','Horror',20,1,2,1);
 try {
  const query = buildStoryQuery(new URLSearchParams({ q: '%_', minWords: '100', status: 'complete' }));
  assert.ok(!('error' in query));
  assert.deepEqual(raw.prepare(query.sql).all(...query.values).map(row => row.id), ['s1']);
  const byTag = buildStoryQuery(new URLSearchParams({ q: 'Fluff' }));
  assert.deepEqual(raw.prepare(byTag.sql).all(...byTag.values).map(row => row.id), ['s1']);
  const exclude = buildStoryQuery(new URLSearchParams({ exclude: 'Horror' }));
  assert.ok(!('error' in exclude));
  assert.deepEqual(raw.prepare(exclude.sql).all(...exclude.values).map(row => row.id), ['s1']);
  for (const params of [{ minWords: 'abc' }, { maxChapters: '3.5' }, { status: 'bad' }, { offset: '-1' }, { offset: '1.5' }, { offset: '1000001' }]) assert.ok('error' in buildStoryQuery(new URLSearchParams(params)));
 } finally { raw.close(); }
});

test('all stories includes classified works without changing folder-specific navigation', () => {
 const { raw } = fixture();
 raw.prepare('INSERT INTO shared_folders (id,name,created_at) VALUES (?,?,?)').run('f','Supergirl',1);
 const add = raw.prepare('INSERT INTO shared_stories (id,folder_id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
 add.run('a','f','a.pdf','pdf',1,'ka','ha','A',1);
 add.run('b',null,'b.pdf','pdf',1,'kb','hb','B',2);
 raw.prepare('UPDATE shared_stories SET fandom = ?, relationship = ? WHERE id = ?').run('Supergirl', 'Kara/Lena', 'a');
 try {
  const all = buildStoryQuery(new URLSearchParams({ all: '1' }));
  assert.deepEqual(raw.prepare(all.sql).all(...all.values).map(row => row.id), ['a','b']);
  const folder = buildStoryQuery(new URLSearchParams({ folder: 'f', all: '1' }));
  assert.deepEqual(raw.prepare(folder.sql).all(...folder.values).map(row => row.id), ['a']);
  const pairing = buildStoryQuery(new URLSearchParams({ q: 'Kara/Lena' }));
  assert.deepEqual(raw.prepare(pairing.sql).all(...pairing.values).map(row => row.id), ['a']);
 } finally { raw.close(); }
});

test('reading history pages all saved positions without exposing another user’s progress', async () => {
 const { raw, db } = fixture();
 const user = raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)');
 user.run('u','User','u@example.invalid',1,1,1); user.run('other','Other','other@example.invalid',1,1,1);
 const story = raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)');
 const position = raw.prepare('INSERT INTO reading_positions (id,user_id,story_id,location,updated_at) VALUES (?,?,?,?,?)');
 for (let i = 0; i < 130; i++) {
  const id = `s${String(i).padStart(3, '0')}`;
  story.run(id, `${id}.pdf`, 'pdf', 1, `k${i}`, `h${i}`, id, 1);
  position.run(`p${i}`, 'u', id, `pdf:${i + 1}`, 1000 + Math.floor(i / 3));
 }
 position.run('other-position', 'other', 's000', 'pdf:999', 9999);
 try {
  const all = []; let cursor = null, pages = 0;
  do {
   const result = await listReadingPositions(db, 'u', cursor);
   all.push(...result.stories); cursor = result.nextCursor; pages++;
  } while (cursor);
  assert.equal(pages, 3); assert.equal(all.length, 130); assert.equal(new Set(all.map(row => row.id)).size, 130);
  assert.equal(all.find(row => row.id === 's000').location, 'pdf:1');
  assert.ok(all.every(row => row.location !== 'pdf:999'));
 } finally { raw.close(); }
});

test('reading filters search the entire private history and preserve filtered pagination', async () => {
 const { raw, db } = fixture();
 const user = raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)');
 user.run('u','User','u@example.invalid',1,1,1); user.run('other','Other','other@example.invalid',1,1,1);
 const story = raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,rating,category,chapter_count,total_chapters,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
 const position = raw.prepare('INSERT INTO reading_positions (id,user_id,story_id,location,updated_at) VALUES (?,?,?,?,?)');
 for (let i = 0; i < 5; i++) {
  story.run(`s${i}`, `s${i}.pdf`, 'pdf', 1, `k${i}`, `h${i}`, i === 4 ? '100%_match' : 'Another', 'Explicit', i === 4 ? 'F/F, Gen' : 'M/M', 2, 2, 1);
  position.run(`p${i}`, 'u', `s${i}`, 'pdf:1', 10 - i);
 }
 story.run('private', 'private.pdf', 'pdf', 1, 'kp', 'hp', '100%_match', 'Secret rating', 'Secret category', 2, 2, 1);
 position.run('private-p', 'other', 'private', 'pdf:1', 20);
 try {
  const filters = parseReadingFilters(new URLSearchParams({ q: '%_', rating: 'Explicit', category: 'Gen', status: 'complete' }));
  const match = await listReadingPositions(db, 'u', null, 2, filters);
  assert.deepEqual(match.stories.map(row => row.id), ['s4']);
  const allFilters = parseReadingFilters(new URLSearchParams({ rating: 'Explicit' }));
  const first = await listReadingPositions(db, 'u', null, 2, allFilters);
  const second = await listReadingPositions(db, 'u', first.nextCursor, 2, allFilters);
  assert.deepEqual([...first.stories, ...second.stories].map(row => row.id), ['s0', 's1', 's2', 's3']);
  assert.deepEqual(await readingFilterOptions(db, 'u'), { ratings: ['Explicit'], categories: ['F/F', 'Gen', 'M/M'] });
  assert.equal(parseReadingFilters(new URLSearchParams({ status: 'other' })), null);
 } finally { raw.close(); }
});

test('catalog pages use bounded sizes and stable offsets without skipping works', () => {
 const { raw } = fixture();
 const insert = raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)');
 for (let i = 0; i < 45; i++) {
  const id = `page-${String(i).padStart(2, '0')}`;
  insert.run(id, `${id}.pdf`, 'pdf', 1, `key-${i}`, `hash-${i}`, id, 1);
 }
 try {
  const read = offset => {
   const query = buildStoryQuery(new URLSearchParams({ all: '1', limit: '20', offset: String(offset) }));
   assert.ok(!('error' in query));
   return { limit: query.limit, rows: raw.prepare(query.sql).all(...query.values).map(row => row.id) };
  };
  const first = read(0), second = read(20), third = read(40);
  assert.equal(first.limit, 20);
  assert.equal(first.rows.length, 21);
  assert.equal(second.rows.length, 21);
  assert.equal(third.rows.length, 5);
  assert.equal(new Set([...first.rows.slice(0, 20), ...second.rows.slice(0, 20), ...third.rows]).size, 45);
  for (const limit of ['0', '101', '-1', '1.5', '1 OR 1']) assert.ok('error' in buildStoryQuery(new URLSearchParams({ limit })));
 } finally { raw.close(); }
});

test('fandom selection combines with search and filters, and unrated includes missing ratings', () => {
 const { raw } = fixture();
 const folder = raw.prepare('INSERT INTO shared_folders (id,name,created_at) VALUES (?,?,?)');
 folder.run('f1','A',1); folder.run('f2','B',1);
 const add = raw.prepare('INSERT INTO shared_stories (id,folder_id,filename,file_type,size,object_key,content_hash,title,rating,category,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
 add.run('a','f1','a.pdf','pdf',1,'ka','ha','A','Explicit','F/F',1);
 add.run('b','f2','b.pdf','pdf',1,'kb','hb','A','Explicit','F/F',1);
 add.run('c','f1','c.pdf','pdf',1,'kc','hc','C',null,'F/F',1);
 add.run('d','f1','d.pdf','pdf',1,'kd','hd','D','Not Rated','F/F',1);
 try {
  const combined = buildStoryQuery(new URLSearchParams({folder:'f1',q:'A',rating:'Explicit',category:'F/F',all:'1'}));
  assert.deepEqual(raw.prepare(combined.sql).all(...combined.values).map(row => row.id), ['a']);
  const unrated = buildStoryQuery(new URLSearchParams({folder:'f1',rating:'__unrated__'}));
  assert.deepEqual(raw.prepare(unrated.sql).all(...unrated.values).map(row => row.id), ['c','d']);
 } finally { raw.close(); }
});

test('multiple included and excluded terms combine without treating SQL wildcards as patterns', () => {
 const { raw } = fixture();
 const add = raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,tags,warnings,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
 add.run('ok','a.pdf','pdf',1,'ka','ha','A','Fluff, Romance','None',1);
 add.run('bad','b.pdf','pdf',1,'kb','hb','B','Fluff, Romance, Angst','Violence',1);
 add.run('missing','c.pdf','pdf',1,'kc','hc','C','Fluff','None',1);
 try {
  const params = new URLSearchParams({all:'1'}); params.append('include','Fluff'); params.append('include','Romance'); params.append('exclude','Angst'); params.append('exclude','Violence');
  const query = buildStoryQuery(params); assert.ok(!('error' in query));
  assert.deepEqual(raw.prepare(query.sql).all(...query.values).map(row => row.id), ['ok']);
  for (let i = 0; i < 11; i++) params.append('exclude', `extra${i}`);
  assert.ok('error' in buildStoryQuery(params));
 } finally { raw.close(); }
});

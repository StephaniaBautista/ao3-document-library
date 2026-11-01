import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { saveMetadata } from '../lib/catalog/metadata-store.ts';
import { parseManualMetadata, saveManualMetadata } from '../lib/catalog/manual-metadata.ts';
function fixture() {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const directory = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, directory), 'utf8'));
 function prepare(sql) { function bound(values) { return { bind: (...args) => bound(args), run: async () => { const result = raw.prepare(sql).run(...values); return { meta: { changes: result.changes } }; }, first: async () => raw.prepare(sql).get(...values) ?? null, execute: () => { const result = raw.prepare(sql).run(...values); return { meta: { changes: result.changes } }; } }; } return bound([]); }
 const db = { prepare, batch: async statements => { raw.exec('BEGIN'); try { const results = statements.map(stmt => stmt.execute()); raw.exec('COMMIT'); return results; } catch (error) { raw.exec('ROLLBACK'); throw error; } } };
 const deleted = []; const bucket = { delete: async key => deleted.push(key) };
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','User','test@example.com',1,1,1);
 const add = raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,ao3_work_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
 add.run('canonical','a.pdf','pdf',1,'canonical-key','hash-a','Story','123',1);
 add.run('duplicate','b.pdf','pdf',1,'duplicate-key','hash-b','Story',null,1);
 raw.prepare('INSERT INTO favorite_collections VALUES (?,?,?,?)').run('c','u','Favorites',1);
 raw.prepare('INSERT INTO favorite_items VALUES (?,?,?,?)').run('f','c','duplicate',1);
 raw.prepare('INSERT INTO reading_positions VALUES (?,?,?,?,?)').run('p','u','duplicate','pdf:3',1);
 raw.prepare('INSERT INTO reading_notes VALUES (?,?,?,?,?,?)').run('n','u','duplicate','pdf:3','note',1);
 raw.prepare('INSERT INTO reminders VALUES (?,?,?,?,?,?)').run('r','u','duplicate','comment','thanks',1);
 return { raw, db, bucket, deleted };
}
test('merging the same AO3 work preserves private references and deletes only the duplicate object', async () => {
 const { raw, db, bucket, deleted } = fixture();
 const result = await saveMetadata(db, bucket, 'duplicate', { ao3Url: 'https://archiveofourown.org/works/123' }, 'pending');
 assert.equal(result.mergedInto, 'canonical');
 for (const table of ['favorite_items','reading_positions','reading_notes','reminders']) assert.equal(raw.prepare(`SELECT story_id FROM ${table}`).get().story_id, 'canonical');
 assert.deepEqual(deleted, ['duplicate-key']);
 assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 1);
 raw.close();
});

test('duplicate merging keeps each reader’s most recent compatible position', async () => {
 const { raw, db, bucket } = fixture();
 const addUser = raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)');
 for (const id of ['v','w']) addUser.run(id,id,`${id}@example.invalid`,1,1,1);
 raw.prepare("UPDATE reading_positions SET location = 'pdf:8', updated_at = 200 WHERE id = 'p'").run();
 const add = raw.prepare('INSERT INTO reading_positions (id,user_id,story_id,location,updated_at) VALUES (?,?,?,?,?)');
 add.run('u-canonical','u','canonical','pdf:2',100);
 add.run('v-duplicate','v','duplicate','pdf:3',100); add.run('v-canonical','v','canonical','pdf:9',300);
 add.run('w-duplicate','w','duplicate','pdf:4',100); add.run('w-canonical','w','canonical','pdf:5',100);
 try {
  assert.equal((await saveMetadata(db,bucket,'duplicate',{ ao3Url:'https://archiveofourown.org/works/123' },'pending')).mergedInto,'canonical');
  const positions = Object.fromEntries(raw.prepare('SELECT user_id,location,updated_at FROM reading_positions WHERE story_id = ?').all('canonical').map(row => [row.user_id, [row.location,row.updated_at]]));
  assert.deepEqual(positions, { u:['pdf:8',200], v:['pdf:9',300], w:['pdf:5',100] });
 } finally { raw.close(); }
});

test('duplicate merging does not apply a PDF position to an EPUB', async () => {
 const { raw, db, bucket } = fixture();
 raw.prepare("UPDATE shared_stories SET file_type = 'epub' WHERE id = 'canonical'").run();
 raw.prepare('INSERT INTO reading_positions (id,user_id,story_id,location,updated_at) VALUES (?,?,?,?,?)').run('canonical-position','u','canonical','epub:existing',1);
 raw.prepare("UPDATE reading_positions SET updated_at = 200 WHERE id = 'p'").run();
 try {
  assert.equal((await saveMetadata(db,bucket,'duplicate',{ ao3Url:'https://archiveofourown.org/works/123' },'pending')).mergedInto,'canonical');
  const position = raw.prepare('SELECT location FROM reading_positions WHERE user_id = ? AND story_id = ?').get('u','canonical');
  assert.equal(position.location,'epub:existing');
 } finally { raw.close(); }
});

test('AO3 metadata merging keeps imported occurrences linked to the retained story', async () => {
 const { raw, db, bucket } = fixture();
 raw.prepare('INSERT INTO drive_import_jobs (id,user_id,created_at) VALUES (?,?,?)').run('job','u',1);
 const add = raw.prepare('INSERT INTO drive_import_items (id,job_id,drive_id,name,mime_type,story_id,duplicate,state,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
 add.run('duplicate','job','file-a','fic.pdf','application/pdf','duplicate',0,'done',1);
 add.run('occurrence','job','file-b','copy.pdf','application/pdf','duplicate',1,'done',1);
 try {
  assert.equal((await saveMetadata(db,bucket,'duplicate',{ ao3Url:'https://archiveofourown.org/works/123' },'pending')).mergedInto,'canonical');
  const rows = raw.prepare('SELECT story_id,duplicate FROM drive_import_items ORDER BY id').all();
  assert.deepEqual(rows.map(row => [row.story_id,row.duplicate]),[['canonical',1],['canonical',1]]);
  raw.prepare('DELETE FROM shared_stories WHERE id = ?').run('canonical');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM drive_import_items WHERE story_id IS NOT NULL').get().n,0);
 } finally { raw.close(); }
});

test('partial extraction retains existing author metadata and the original AO3 link', async () => {
 const { raw, db, bucket } = fixture();
 raw.prepare('UPDATE shared_stories SET author = ?, summary = ?, tags = ?, word_count = ?, ao3_url = ?, ao3_work_id = ? WHERE id = ?').run('Author', 'Author summary', 'Tag', 1234, 'https://archiveofourown.org/works/456', '456', 'duplicate');
 try {
  assert.equal((await saveMetadata(db, bucket, 'duplicate', { title:'Extracted title', fandom:'Fandom' }, 'pending')).ok, true);
  const row = raw.prepare('SELECT title,author,summary,tags,fandom,word_count,ao3_url,ao3_work_id FROM shared_stories WHERE id = ?').get('duplicate');
  assert.deepEqual({ ...row }, { title:'Extracted title', author:'Author', summary:'Author summary', tags:'Tag', fandom:'Fandom', word_count:1234, ao3_url:'https://archiveofourown.org/works/456', ao3_work_id:'456' });
 } finally { raw.close(); }
});

test('administrator edits, including deliberate blanks, survive an in-flight extraction', async () => {
 const { raw, db, bucket } = fixture();
 try {
  raw.prepare("UPDATE shared_stories SET metadata_status = 'processing', metadata_claimed_at = 100 WHERE id = ?").run('duplicate');
  const edits = parseManualMetadata({ summary:'  Resumen corregido  ', warnings:'', tags:'Manual tag' });
  assert.ok(edits); assert.equal(await saveManualMetadata(db, 'duplicate', edits, 123), true);
  assert.equal((await saveMetadata(db, bucket, 'duplicate', { summary:'Outdated summary', warnings:'Old warning', tags:'Old tag', fandom:'New fandom' }, 'processing', 100)).ok, true);
  const row = raw.prepare('SELECT summary,warnings,tags,fandom,metadata_manual_fields FROM shared_stories WHERE id = ?').get('duplicate');
  assert.equal(row.summary, 'Resumen corregido'); assert.equal(row.warnings, null); assert.equal(row.tags, 'Manual tag'); assert.equal(row.fandom, 'New fandom');
  assert.deepEqual(JSON.parse(row.metadata_manual_fields), { summary:123, tags:123, warnings:123 });
  for (const invalid of [null, [], { title:'   ' }, { summary:4 }, { unknown:'value' }]) assert.equal(parseManualMetadata(invalid), null);
 } finally { raw.close(); }
});

test('duplicate merging transfers manual corrections without replacing canonical corrections', async () => {
 const { raw, db, bucket } = fixture();
 try {
  await saveManualMetadata(db, 'duplicate', parseManualMetadata({ title:'Duplicate title', summary:'Author summary corrected' }), 100);
  await saveManualMetadata(db, 'canonical', parseManualMetadata({ title:'Canonical title' }), 200);
  const result = await saveMetadata(db, bucket, 'duplicate', { ao3Url:'https://archiveofourown.org/works/123' }, 'pending');
  assert.equal(result.mergedInto, 'canonical');
  const row = raw.prepare('SELECT title,summary,metadata_manual_fields FROM shared_stories WHERE id = ?').get('canonical');
  assert.equal(row.title, 'Canonical title'); assert.equal(row.summary, 'Author summary corrected');
  const versions = JSON.parse(row.metadata_manual_fields);
  assert.equal(versions.title, 200); assert.equal(versions.summary, 100);
 } finally { raw.close(); }
});

test('the most recent manual correction survives when both duplicates were edited', async () => {
 const { raw, db, bucket } = fixture();
 try {
  await saveManualMetadata(db, 'canonical', parseManualMetadata({ summary:'Older summary' }), 100);
  await saveManualMetadata(db, 'duplicate', parseManualMetadata({ summary:'Newest summary' }), 200);
  assert.equal((await saveMetadata(db, bucket, 'duplicate', { ao3Url:'https://archiveofourown.org/works/123' }, 'pending')).mergedInto, 'canonical');
  const row = raw.prepare('SELECT summary, metadata_manual_fields FROM shared_stories WHERE id = ?').get('canonical');
  assert.equal(row.summary, 'Newest summary'); assert.equal(JSON.parse(row.metadata_manual_fields).summary, 200);
 } finally { raw.close(); }
});

test('merging fills missing original metadata without replacing manual blanks or existing data', async () => {
 const { raw, db, bucket } = fixture();
 try {
  raw.prepare('UPDATE shared_stories SET author = ?, summary = ?, word_count = ? WHERE id = ?').run('Original author','Original author summary',4200,'duplicate');
  raw.prepare('UPDATE shared_stories SET fandom = ? WHERE id = ?').run('Existing fandom','canonical');
  await saveManualMetadata(db,'canonical',parseManualMetadata({ warnings:'' }),200);
  const extracted = { ao3Url:'https://archiveofourown.org/works/123', relationship:'Pair', warnings:'Extracted warning', chapterCount:6, totalChapters:7 };
  assert.equal((await saveMetadata(db,bucket,'duplicate',extracted,'pending')).mergedInto,'canonical');
  const row = raw.prepare('SELECT author,summary,fandom,relationship,warnings,word_count,chapter_count,total_chapters FROM shared_stories WHERE id = ?').get('canonical');
  assert.deepEqual({ ...row }, { author:'Original author', summary:'Original author summary', fandom:'Existing fandom', relationship:'Pair', warnings:null, word_count:4200, chapter_count:6, total_chapters:7 });
 } finally { raw.close(); }
});
test('a story already processed is not modified or deleted', async () => {
 const { raw, db, bucket, deleted } = fixture();
 raw.prepare("UPDATE shared_stories SET metadata_status = 'done' WHERE id = 'duplicate'").run();
 const result = await saveMetadata(db, bucket, 'duplicate', { ao3Url: 'https://archiveofourown.org/works/123' }, 'pending');
 assert.equal(result.ok, false);
 assert.deepEqual(deleted, []);
 assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 2);
 raw.close();
});

test('a state change just before merging leaves private references on the original story', async () => {
 const { raw, db, bucket, deleted } = fixture();
 const originalBatch = db.batch;
 db.batch = async statements => {
  raw.prepare("UPDATE shared_stories SET metadata_status = 'done' WHERE id = ?").run('duplicate');
  return originalBatch(statements);
 };
 try {
  const result = await saveMetadata(db, bucket, 'duplicate', { ao3Url: 'https://archiveofourown.org/works/123' }, 'pending');
  assert.equal(result.ok, false);
  for (const table of ['favorite_items','reading_positions','reading_notes','reminders']) assert.equal(raw.prepare(`SELECT story_id FROM ${table}`).get().story_id, 'duplicate');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 2);
  assert.deepEqual(deleted, []);
 } finally { raw.close(); }
});

test('an expired metadata claim cannot merge or overwrite the newer worker result', async () => {
 const { raw, db, bucket, deleted } = fixture();
 try {
  raw.prepare("UPDATE shared_stories SET metadata_status = 'processing', metadata_claimed_at = 200 WHERE id = ?").run('duplicate');
  const merge = await saveMetadata(db, bucket, 'duplicate', { ao3Url: 'https://archiveofourown.org/works/123' }, 'processing', 100);
  const update = await saveMetadata(db, bucket, 'duplicate', { title: 'Outdated' }, 'processing', 100);
  assert.equal(merge.ok, false); assert.equal(update.ok, false);
  const source = raw.prepare('SELECT title, metadata_claimed_at FROM shared_stories WHERE id = ?').get('duplicate');
  assert.equal(source.title, 'Story'); assert.equal(source.metadata_claimed_at, 200);
  for (const table of ['favorite_items','reading_positions','reading_notes','reminders']) assert.equal(raw.prepare(`SELECT story_id FROM ${table}`).get().story_id, 'duplicate');
  assert.deepEqual(deleted, []);
 } finally { raw.close(); }
});

test('the source story is preserved if the canonical story disappears or changes before merging', async () => {
 for (const change of ['delete', 'change']) {
  const { raw, db, bucket, deleted } = fixture(); const originalBatch = db.batch;
  db.batch = async statements => {
   if (change === 'delete') raw.prepare('DELETE FROM shared_stories WHERE id = ?').run('canonical');
   else raw.prepare('UPDATE shared_stories SET ao3_work_id = ? WHERE id = ?').run('456', 'canonical');
   return originalBatch(statements);
  };
  try {
   const result = await saveMetadata(db, bucket, 'duplicate', { ao3Url: 'https://archiveofourown.org/works/123' }, 'pending');
   assert.equal(result.ok, false);
   assert.ok(raw.prepare('SELECT id FROM shared_stories WHERE id = ?').get('duplicate'));
   for (const table of ['favorite_items','reading_positions','reading_notes','reminders']) assert.equal(raw.prepare(`SELECT story_id FROM ${table}`).get().story_id, 'duplicate');
   assert.equal(raw.prepare('SELECT count(*) AS n FROM object_deletions').get().n, 0);
   assert.deepEqual(deleted, []);
  } finally { raw.close(); }
 }
});

test('a duplicate remains merged when storage deletion must be retried', async () => {
 const { raw, db } = fixture();
 try {
  const result = await saveMetadata(db, { delete: async () => { throw new Error('storage unavailable'); } }, 'duplicate', { ao3Url: 'https://archiveofourown.org/works/123' }, 'pending');
  assert.equal(result.mergedInto, 'canonical');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 1);
  assert.equal(raw.prepare('SELECT deleted_at FROM object_deletions WHERE object_key = ?').get('duplicate-key').deleted_at, null);
  assert.equal(raw.prepare('SELECT story_id FROM reminders').get().story_id, 'canonical');
 } finally { raw.close(); }
});

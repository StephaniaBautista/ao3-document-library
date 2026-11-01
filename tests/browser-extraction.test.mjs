import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { claimBrowserExtraction, finishBrowserExtraction, requeueStaleExtractions, saveBrowserSegments } from '../lib/catalog/browser-extraction.ts';

function fixture() {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const directory = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, directory), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','User','test@example.invalid',1,1,1);
 raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)').run('s','s.pdf','pdf',1,'key','hash','Story',1);
 raw.prepare('INSERT INTO translation_jobs (id,user_id,story_id,target_language,created_at,extraction_state) VALUES (?,?,?,?,?,?)').run('j','u','s','es',1,'failed');
 raw.prepare("INSERT INTO translation_segments (id,job_id,position,source_text,translated_text,state,updated_at) VALUES (?,?,?,?,?,'done',?)").run('old','j',0,'server text','texto anterior',1);
 raw.prepare('UPDATE translation_jobs SET extraction_next_page = 1, extraction_next_position = 1, reading_position = 4 WHERE id = ?').run('j');
 function prepare(sql) { function bound(values) { const execute = () => { const result = raw.prepare(sql).run(...values); return { meta: { changes: result.changes } }; }; return { bind: (...args) => bound(args), run: async () => execute(), execute }; } return bound([]); }
 const db = { prepare, batch: async statements => { raw.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); raw.exec('COMMIT'); return results; } catch (error) { raw.exec('ROLLBACK'); throw error; } } };
 return { raw, db };
}

test('browser fallback replaces partial server text only on success and rejects other claims', async () => {
 const { raw, db } = fixture();
 try {
  assert.equal(await claimBrowserExtraction(db, 'other', 'j', 1000), null);
  const claim = await claimBrowserExtraction(db, 'u', 'j', 1000); assert.ok(claim);
  assert.equal(raw.prepare('SELECT reading_position FROM translation_jobs').get().reading_position, 0);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM translation_segments').get().n, 0);
  assert.deepEqual({ ...raw.prepare('SELECT source_text, translated_text FROM translation_browser_backup_segments').get() }, { source_text: 'server text', translated_text: 'texto anterior' });
  assert.equal(await claimBrowserExtraction(db, 'u', 'j', 1001), null);
  assert.equal(await saveBrowserSegments(db, 'u', 'j', 'wrong-claim', [{ position: 0, text: 'wrong' }], 1002), false);
  assert.equal(await saveBrowserSegments(db, 'u', 'j', claim, [{ position: 0, text: 'browser text' }], 1003), true);
  assert.equal(await finishBrowserExtraction(db, 'u', 'j', 'wrong-claim'), false);
  assert.equal(await finishBrowserExtraction(db, 'u', 'j', claim), true);
  assert.deepEqual({ ...raw.prepare('SELECT source_text, position FROM translation_segments').get() }, { source_text: 'browser text', position: 0 });
  assert.equal(raw.prepare('SELECT count(*) AS n FROM translation_browser_backups').get().n, 0);
  assert.equal(raw.prepare('SELECT extraction_state FROM translation_jobs').get().extraction_state, 'done');
 } finally { raw.close(); }
});

test('failed or abandoned browser extraction restores the prior text and reading position', async () => {
 const { raw, db } = fixture();
 try {
  const claim = await claimBrowserExtraction(db, 'u', 'j', 1000);
  await saveBrowserSegments(db, 'u', 'j', claim, [{ position: 0, text: 'partial' }], 1001);
  raw.prepare('UPDATE translation_jobs SET reading_position = 7 WHERE id = ?').run('j');
  await requeueStaleExtractions(db, 601002);
  assert.deepEqual({ ...raw.prepare('SELECT source_text, translated_text, state FROM translation_segments').get() }, { source_text:'server text', translated_text:'texto anterior', state:'done' });
  assert.deepEqual({ ...raw.prepare('SELECT extraction_state, extraction_next_page, extraction_next_position, reading_position FROM translation_jobs').get() }, { extraction_state:'pending', extraction_next_page:1, extraction_next_position:1, reading_position:4 });
  assert.equal(raw.prepare('SELECT count(*) AS n FROM translation_browser_backups').get().n, 0);
  assert.equal(await saveBrowserSegments(db, 'u', 'j', claim, [{ position: 1, text: 'late' }], 601003), false);
  const next = await claimBrowserExtraction(db, 'u', 'j', 601004);
  assert.equal(await finishBrowserExtraction(db, 'u', 'j', claim, true), false);
  assert.equal(raw.prepare('SELECT source_text FROM translation_browser_backup_segments').get().source_text, 'server text');
  await saveBrowserSegments(db, 'u', 'j', next, [{ position: 0, text: 'new partial' }], 601005);
  raw.prepare('UPDATE translation_jobs SET reading_position = 4 WHERE id = ?').run('j');
  assert.equal(await finishBrowserExtraction(db, 'u', 'j', next, true), true);
  assert.equal(raw.prepare('SELECT source_text FROM translation_segments').get().source_text, 'server text');
  assert.equal(raw.prepare('SELECT reading_position FROM translation_jobs').get().reading_position, 4);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM translation_browser_backups').get().n, 0);
  assert.equal(raw.prepare('SELECT extraction_state FROM translation_jobs').get().extraction_state, 'failed');
 } finally { raw.close(); }
});

test('a previously processing fragment is requeued after browser recovery', async () => {
 const { raw, db } = fixture();
 try {
  raw.prepare("UPDATE translation_segments SET state = 'processing' WHERE id = 'old'").run();
  const claim = await claimBrowserExtraction(db, 'u', 'j', 1000);
  assert.equal(await finishBrowserExtraction(db, 'u', 'j', claim, true), true);
  assert.equal(raw.prepare('SELECT state FROM translation_segments WHERE id = ?').get('old').state, 'pending');
 } finally { raw.close(); }
});

test('a failure while saving a browser backup rolls the entire claim back', async () => {
 const { raw, db } = fixture();
 try {
  const originalBatch = db.batch; let calls = 0;
  db.batch = async statements => {
   if (++calls === 1) return originalBatch(statements);
   raw.exec('BEGIN');
   try {
    for (const statement of statements.slice(0, 3)) statement.execute();
    throw new Error('simulated database failure');
   } catch (error) { raw.exec('ROLLBACK'); throw error; }
  };
  await assert.rejects(claimBrowserExtraction(db, 'u', 'j', 1000), /simulated database failure/);
  assert.equal(raw.prepare('SELECT extraction_state FROM translation_jobs').get().extraction_state, 'failed');
  assert.equal(raw.prepare('SELECT source_text FROM translation_segments').get().source_text, 'server text');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM translation_browser_backups').get().n, 0);
 } finally { raw.close(); }
});

test('browser completion refuses empty or discontinuous fragments and keeps the backup', async () => {
 const { raw, db } = fixture();
 try {
  const claim = await claimBrowserExtraction(db, 'u', 'j', 1000);
  assert.equal(await finishBrowserExtraction(db, 'u', 'j', claim), false);
  await saveBrowserSegments(db, 'u', 'j', claim, [{ position: 1, text: 'second' }], 1001);
  assert.equal(await finishBrowserExtraction(db, 'u', 'j', claim), false);
  assert.equal(raw.prepare('SELECT source_text FROM translation_browser_backup_segments').get().source_text, 'server text');
  await saveBrowserSegments(db, 'u', 'j', claim, [{ position: 0, text: 'first' }], 1002);
  assert.equal(await finishBrowserExtraction(db, 'other', 'j', claim), false);
  assert.equal(await finishBrowserExtraction(db, 'u', 'j', claim), true);
  assert.deepEqual(raw.prepare('SELECT source_text FROM translation_segments ORDER BY position').all().map(row => row.source_text), ['first','second']);
 } finally { raw.close(); }
});

test('deleting an account also removes temporary browser backups', async () => {
 const { raw, db } = fixture();
 try {
  await claimBrowserExtraction(db, 'u', 'j', 1000);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM translation_browser_backup_segments').get().n, 1);
  raw.prepare('DELETE FROM user WHERE id = ?').run('u');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM translation_browser_backups').get().n, 0);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM translation_browser_backup_segments').get().n, 0);
 } finally { raw.close(); }
});

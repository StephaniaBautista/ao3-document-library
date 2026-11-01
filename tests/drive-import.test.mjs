import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { processDriveImports } from '../lib/catalog/drive-import.ts';
import { flushObjectDeletion, removeStory } from '../lib/catalog/object-deletions.ts';
import { driveRequestHeaders, loadDriveRootFolder, parseDriveFolderUrl } from '../lib/catalog/drive-reference.ts';
import { listDriveDuplicates } from '../lib/catalog/drive-duplicates.ts';

// The local fake consumes streams as R2 does; the Worker runtime provides this class.
globalThis.FixedLengthStream ??= class extends TransformStream { constructor() { super(); } };

function fixture() {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 for (const name of ['0000_lush_magdalene.sql','0001_tough_stephen_strange.sql','0002_high_power_pack.sql','0003_gigantic_jigsaw.sql','0004_busy_tattoo.sql','0005_volatile_blackheart.sql','0006_far_dazzler.sql','0007_messy_tarot.sql','0008_certain_maddog.sql','0009_slow_ozymandias.sql','0010_shallow_tusk.sql','0011_lazy_ma_gnuci.sql','0012_lumpy_blue_blade.sql','0013_silky_doomsday.sql', '0014_perfect_ravenous.sql', '0015_low_drax.sql', '0016_polite_human_fly.sql', '0017_grey_fat_cobra.sql', '0018_sharp_blockbuster.sql', '0019_amused_bishop.sql', '0020_left_human_fly.sql', '0021_nebulous_secret_warriors.sql', '0022_sweet_madame_hydra.sql', '0023_brave_overlord.sql', '0024_spotty_barracuda.sql', '0025_flimsy_victor_mancha.sql', '0026_early_mentallo.sql', '0027_married_mojo.sql', '0028_slow_xorn.sql', '0029_round_imperial_guard.sql', '0030_mute_raza.sql', '0031_ordinary_tusk.sql', '0032_fearless_alex_power.sql']) raw.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'));
 raw.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('admin', 'Admin', 'test@example.com', 1, 1, 1);
 raw.prepare('INSERT INTO library_profiles (user_id, age_verified, created_at) VALUES (?, ?, ?)').run('admin', 1, 1);
 raw.prepare('INSERT INTO drive_import_jobs (id, user_id, created_at) VALUES (?, ?, ?)').run('job', 'admin', 1);
 raw.prepare('INSERT INTO drive_import_items (id, job_id, drive_id, name, mime_type, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('root-item', 'job', 'root', 'Fandom', 'application/vnd.google-apps.folder', 1);
 function prepare(sql) { function bound(values) { const execute = () => { const result = raw.prepare(sql).run(...values); return { meta: { changes: result.changes } }; }; return { bind: (...args) => bound(args), run: async () => execute(), first: async () => raw.prepare(sql).get(...values) ?? null, all: async () => ({ results: raw.prepare(sql).all(...values) }), execute }; } return bound([]); }
 const db = { prepare, batch: async statements => { raw.exec('BEGIN'); try { const results = statements.map(stmt => stmt.execute()); raw.exec('COMMIT'); return results; } catch (error) { raw.exec('ROLLBACK'); throw error; } } };
 const objects = new Map(); const bucket = { delete: async key => objects.delete(key), createMultipartUpload: async key => {
  const parts = new Map();
  return {
   uploadPart: async (number, stream) => { parts.set(number, new Uint8Array(await new Response(stream).arrayBuffer())); return { partNumber: number, etag: `part-${number}` }; },
   complete: async () => { const blob = new Blob([...parts.values()]); objects.set(key, await blob.arrayBuffer()); },
   abort: async () => { parts.clear(); },
  };
 } };
 return { raw, objects, env: { DB: db, BUCKET: bucket, LIBRARY_ADMIN_USER_ID: 'admin' } };
}

test('imports folders recursively, copies files and keeps one identical story', async () => {
 const { raw, objects, env } = fixture(); const original = globalThis.fetch;
 globalThis.fetch = async (url, init) => {
  assert.equal(init.redirect, 'manual');
  const value = String(url);
  if (value.includes('/drive/v3/files?')) {
   const query = new URL(value).searchParams.get('q');
   if (query.includes("'root'")) return Response.json({ files: [{ id: 'sub', name: 'Pareja', mimeType: 'application/vnd.google-apps.folder' }, { id: 'file1', name: 'fic.pdf', mimeType: 'application/pdf' }] });
   return Response.json({ files: [{ id: 'file2', name: 'repeat.pdf', mimeType: 'application/pdf' }] });
  }
  return new Response('%PDF-example', { headers: { 'Content-Length': '12' } });
 };
 try {
  for (let i = 0; i < 5; i++) await processDriveImports(env, async () => 'test-token');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_folders').get().n, 2);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 1);
  assert.equal(objects.size, 1);
  const items = raw.prepare("SELECT id, story_id, duplicate FROM drive_import_items WHERE mime_type = 'application/pdf' ORDER BY duplicate").all();
  assert.equal(items.length, 2); assert.equal(items[0].duplicate, 0); assert.equal(items[1].duplicate, 1);
  assert.equal(items[0].story_id, items[1].story_id);
  const review = await listDriveDuplicates(env.DB, 'job', null);
  assert.equal(review.duplicates.length, 2); assert.ok(review.duplicates.every(row => row.storyId === items[0].story_id));
  assert.ok(review.duplicates.some(row => /Fandom \/ Pareja \/ repeat\.pdf/.test(row.sourcePath)));
  assert.ok(review.duplicates.some(row => /Fandom \/ fic\.pdf/.test(row.sourcePath)));
  assert.equal(review.duplicates[0].currentFolderPath, 'Fandom');
  const pair = raw.prepare("SELECT id FROM shared_folders WHERE name = 'Pareja'").get().id;
  raw.prepare('UPDATE shared_stories SET folder_id = ? WHERE id = ?').run(pair, items[0].story_id);
  assert.equal((await listDriveDuplicates(env.DB, 'job', null)).duplicates[0].currentFolderPath, 'Fandom / Pareja');
  assert.equal(raw.prepare('SELECT state FROM drive_import_jobs').get().state, 'done');
 } finally { globalThis.fetch = original; raw.close(); }
});

test('one import job processes multiple independent root folders', async () => {
 const { raw, objects, env } = fixture(); const original = globalThis.fetch;
 raw.prepare('INSERT INTO drive_import_items (id, job_id, drive_id, name, mime_type, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('second-item', 'job', 'second', 'Otro fandom', 'application/vnd.google-apps.folder', 1);
 globalThis.fetch = async (url, init) => {
  assert.equal(init.redirect, 'manual');
  const value = String(url);
  if (value.includes('/drive/v3/files?')) {
   const query = new URL(value).searchParams.get('q');
   return Response.json({ files: query.includes("'second'") ? [{ id: 'second-file', name: 'second.pdf', mimeType: 'application/pdf' }] : [{ id: 'first-file', name: 'first.pdf', mimeType: 'application/pdf' }] });
  }
  const content = value.includes('second-file') ? '%PDF-second' : '%PDF-first';
  return new Response(content, { headers: { 'Content-Length': String(content.length) } });
 };
 try {
  for (let i = 0; i < 4; i++) await processDriveImports(env, async () => 'test-token');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_folders WHERE parent_id IS NULL').get().n, 2);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 2);
  assert.equal(objects.size, 2);
  assert.equal(raw.prepare('SELECT state FROM drive_import_jobs').get().state, 'done');
 } finally { globalThis.fetch = original; raw.close(); }
});

test('a later import exposes both source folders while retaining the original story and personal data', async () => {
 const { raw, objects, env } = fixture(); const original = globalThis.fetch;
 globalThis.fetch = async input => {
  const url = new URL(input);
  if (url.pathname === '/drive/v3/files') {
   const second = url.searchParams.get('q').includes("'second'");
   return Response.json({ files: [{ id:second ? 'file2' : 'file1', name:second ? 'repeat.pdf' : 'fic.pdf', mimeType:'application/pdf' }] });
  }
  return new Response('%PDF-example', { headers:{ 'Content-Length':'12' } });
 };
 try {
  for (let i=0; i<3; i++) await processDriveImports(env, async () => 'test-token');
  const storyId=raw.prepare('SELECT id FROM shared_stories').get().id;
  raw.prepare('INSERT INTO favorite_collections (id,user_id,name,created_at) VALUES (?,?,?,?)').run('collection','admin','Favorite',1);
  raw.prepare('INSERT INTO favorite_items (id,collection_id,story_id,created_at) VALUES (?,?,?,?)').run('favorite','collection',storyId,1);
  raw.prepare('INSERT INTO reading_positions (id,user_id,story_id,location,updated_at) VALUES (?,?,?,?,?)').run('position','admin',storyId,'pdf:8',1);
  raw.prepare('INSERT INTO drive_import_jobs (id,user_id,created_at) VALUES (?,?,?)').run('later','admin',2);
  raw.prepare('INSERT INTO drive_import_items (id,job_id,drive_id,name,mime_type,updated_at) VALUES (?,?,?,?,?,?)').run('second-root','later','second','Otro fandom','application/vnd.google-apps.folder',1);
  for (let i=0; i<3; i++) await processDriveImports(env, async () => 'test-token');
  assert.equal(objects.size,1);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n,1);
  for (const jobId of ['job','later']) {
   const duplicates=(await listDriveDuplicates(env.DB,jobId,null)).duplicates;
   assert.deepEqual(duplicates.map(item=>item.sourcePath).sort(),['Fandom / fic.pdf','Otro fandom / repeat.pdf']);
   assert.ok(duplicates.every(item=>item.storyId===storyId));
  }
  const destination=raw.prepare("SELECT id FROM shared_folders WHERE name = 'Otro fandom'").get().id;
  raw.prepare('UPDATE shared_stories SET folder_id = ? WHERE id = ?').run(destination,storyId);
  assert.equal((await listDriveDuplicates(env.DB,'job',null)).duplicates[0].currentFolderPath,'Otro fandom');
  assert.equal(raw.prepare('SELECT story_id FROM favorite_items WHERE id = ?').get('favorite').story_id,storyId);
  assert.equal(raw.prepare('SELECT location FROM reading_positions WHERE id = ?').get('position').location,'pdf:8');
 } finally { globalThis.fetch=original; raw.close(); }
});

test('Drive folder links retain resource keys and reject unsafe or ambiguous references', () => {
 assert.deepEqual(parseDriveFolderUrl('https://drive.google.com/drive/u/0/folders/folder_1?resourcekey=0-abc_DEF'), { id: 'folder_1', resourceKey: '0-abc_DEF' });
 assert.deepEqual(parseDriveFolderUrl('https://drive.google.com/drive/folders/folder_1'), { id: 'folder_1', resourceKey: null });
 for (const url of ['http://drive.google.com/drive/folders/x', 'https://drive.google.com.evil.invalid/drive/folders/x', 'https://user@drive.google.com/drive/folders/x', 'https://drive.google.com/drive/folders/x?resourcekey=abc%2Fbad', 'https://drive.google.com/drive/folders/x?resourcekey=a&resourceKey=b']) assert.equal(parseDriveFolderUrl(url), null);
 assert.equal(driveRequestHeaders('token','folder_1','0-key')['X-Goog-Drive-Resource-Keys'], 'folder_1/0-key');
 assert.throws(() => driveRequestHeaders('token','folder_1','bad/key'));
});

test('a root shortcut resolves to its actual folder with the appropriate resource keys', async () => {
 const original = globalThis.fetch, calls = [];
 globalThis.fetch = async (input, init) => {
  const url = new URL(input), id = url.pathname.split('/').at(-1); calls.push({ id, headers:init.headers });
  assert.equal(init.redirect, 'manual'); assert.equal(url.searchParams.get('supportsAllDrives'), 'true');
  return Response.json(id === 'alias' ? { id, name:'Shared folder', mimeType:'application/vnd.google-apps.shortcut', shortcutDetails:{ targetId:'actual', targetResourceKey:'target-key' } } : { id, mimeType:'application/vnd.google-apps.folder', trashed:false });
 };
 try {
  const result = await loadDriveRootFolder('synthetic', 'alias', 'alias-key');
  assert.deepEqual(result, { id:'alias', name:'Shared folder', mimeType:'application/vnd.google-apps.folder', targetDriveId:'actual', resourceKey:'target-key' });
  assert.equal(calls[0].headers['X-Goog-Drive-Resource-Keys'], 'alias/alias-key');
  assert.equal(calls[1].headers['X-Goog-Drive-Resource-Keys'], 'actual/target-key');
 } finally { globalThis.fetch = original; }
});

test('follows shortcuts and resource keys, preserves folders, deduplicates files, and reports cycles', async () => {
 const { raw, objects, env } = fixture(); const original = globalThis.fetch, requests = [];
 raw.prepare('UPDATE drive_import_items SET resource_key = ? WHERE id = ?').run('root-key', 'root-item');
 const shortcut = 'application/vnd.google-apps.shortcut', folder = 'application/vnd.google-apps.folder';
 globalThis.fetch = async (input, init) => {
  const url = new URL(input); requests.push({ url, headers: init.headers });
  assert.equal(init.redirect, 'manual'); assert.equal(url.searchParams.get('supportsAllDrives'), 'true');
  if (url.pathname === '/drive/v3/files') {
   assert.equal(url.searchParams.get('includeItemsFromAllDrives'), 'true');
   const root = url.searchParams.get('q').includes("'root'");
   assert.equal(init.headers['X-Goog-Drive-Resource-Keys'], root ? 'root/root-key' : 'album/album-key');
   return Response.json({ files: root ? [
    { id:'shortcutA',name:'A',mimeType:shortcut }, { id:'shortcutB',name:'B',mimeType:shortcut }, { id:'shortcutFile',name:'Story.pdf',mimeType:shortcut }, { id:'unrelated',name:'Notes',mimeType:shortcut },
   ] : [ { id:'document',name:'Story.pdf',mimeType:'application/pdf',resourceKey:'doc-key' }, { id:'loop',name:'Loop',mimeType:shortcut } ] });
  }
  const id = url.pathname.split('/').at(-1);
  const targets = { shortcutA:['album','album-key'], shortcutB:['album','album-key'], shortcutFile:['document','doc-key'], loop:['root','root-key'], unrelated:['text',''] };
  if (targets[id]) return Response.json({ id, shortcutDetails:{ targetId:targets[id][0], targetResourceKey:targets[id][1] || undefined } });
  const expectedKey = id === 'album' ? 'album-key' : id === 'document' ? 'doc-key' : id === 'root' ? 'root-key' : null;
  if (expectedKey) assert.equal(init.headers['X-Goog-Drive-Resource-Keys'], `${id}/${expectedKey}`);
  if (url.searchParams.get('alt') === 'media') return new Response('%PDF-example', { headers:{ 'Content-Length':'12' } });
  return Response.json({ id, mimeType:id === 'text' ? 'text/plain' : id === 'document' ? 'application/pdf' : folder, trashed:false });
 };
 try {
  for (let i = 0; i < 20; i++) await processDriveImports(env, async () => 'test-token');
  assert.equal(raw.prepare("SELECT count(*) AS n FROM shared_folders WHERE name IN ('A','B')").get().n, 2);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 1); assert.equal(objects.size, 1);
  assert.equal(raw.prepare("SELECT count(*) AS n FROM drive_import_items WHERE drive_id = 'document'").get().n, 2);
  assert.equal(raw.prepare("SELECT count(*) AS n FROM drive_import_items WHERE drive_id = 'loop' AND state = 'failed' AND error LIKE '%cycle%'").get().n, 2);
  assert.equal(raw.prepare("SELECT state FROM drive_import_items WHERE drive_id = 'unrelated'").get().state, 'done');
  assert.equal(raw.prepare("SELECT count(*) AS n FROM drive_import_items WHERE state = 'done' AND resource_key IS NOT NULL").get().n, 0);
  assert.equal(raw.prepare('SELECT state FROM drive_import_jobs').get().state, 'failed');
  assert.ok(requests.length < 30);
 } finally { globalThis.fetch = original; raw.close(); }
});

test('an inaccessible shortcut is reported and can be retried after access is granted', async () => {
 const { raw, objects, env } = fixture(); const original = globalThis.fetch; let granted = false;
 globalThis.fetch = async input => {
  const url = new URL(input);
  if (url.pathname === '/drive/v3/files') return Response.json({ files:[{ id:'alias',name:'fic.pdf',mimeType:'application/vnd.google-apps.shortcut' }] });
  const id = url.pathname.split('/').at(-1);
  if (id === 'alias') return granted ? Response.json({ id, shortcutDetails:{ targetId:'actual' } }) : new Response(null, {status:403});
  if (url.searchParams.get('alt') === 'media') return new Response('%PDF-example', { headers:{ 'Content-Length':'12' } });
  return Response.json({ id:'actual', mimeType:'application/pdf', trashed:false });
 };
 try {
  for (let i = 0; i < 3; i++) await processDriveImports(env, async () => 'test-token');
  assert.match(raw.prepare("SELECT error FROM drive_import_items WHERE drive_id = 'alias'").get().error, /shortcut/);
  granted = true;
  raw.prepare("UPDATE drive_import_items SET state = 'pending', error = NULL WHERE drive_id = 'alias'").run();
  await processDriveImports(env, async () => 'test-token');
  assert.equal(raw.prepare("SELECT state FROM drive_import_items WHERE drive_id = 'alias'").get().state, 'done');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 1); assert.equal(objects.size, 1);
 } finally { globalThis.fetch = original; raw.close(); }
});

test('a retry whose destination folder was deleted does not import the story into the root', async () => {
 const { raw, objects, env } = fixture(); let tokenRequests = 0;
 raw.prepare("UPDATE drive_import_items SET state = 'done' WHERE id = 'root-item'").run();
 raw.prepare('INSERT INTO drive_import_items (id,job_id,drive_id,name,mime_type,parent_item_id,parent_folder_id,state,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('orphan','job','file','fic.pdf','application/pdf','root-item',null,'pending',1);
 try {
  await processDriveImports(env, async () => { tokenRequests++; return 'synthetic'; });
  const row = raw.prepare('SELECT state,error FROM drive_import_items WHERE id = ?').get('orphan');
  assert.equal(row.state,'failed'); assert.match(row.error,/destination folder no longer exists/i);
  assert.equal(tokenRequests,0); assert.equal(objects.size,0);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n,0);
 } finally { raw.close(); }
});

test('imports a Drive file larger than the former 50 MiB limit', async () => {
 const { raw, objects, env } = fixture(); const original = globalThis.fetch;
 const bytes = new Uint8Array(51 * 1024 * 1024 + 1); bytes.set(new TextEncoder().encode('%PDF-'));
 globalThis.fetch = async (url, init) => {
  assert.equal(init.redirect, 'manual');
  const value = String(url);
  if (value.includes('/drive/v3/files?')) return Response.json({ files: [{ id: 'large', name: 'large.pdf', mimeType: 'application/pdf' }] });
  return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } });
 };
 try {
  for (let i = 0; i < 3; i++) await processDriveImports(env, async () => 'test-token');
  assert.equal(raw.prepare('SELECT size FROM shared_stories').get().size, bytes.length);
  assert.equal(objects.size, 1);
  assert.equal(raw.prepare('SELECT state FROM drive_import_jobs').get().state, 'done');
 } finally { globalThis.fetch = original; raw.close(); }
});

test('a Drive redirect is not followed with the account token', async () => {
 const { raw, env } = fixture(); const original = globalThis.fetch; let requests = 0;
 globalThis.fetch = async (_url, init) => {
  requests++;
  assert.equal(init.redirect, 'manual');
  return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/steal' } });
 };
 try {
  await processDriveImports(env, async () => 'test-token');
  assert.equal(requests, 1);
  assert.equal(raw.prepare('SELECT state FROM drive_import_jobs').get().state, 'failed');
 } finally { globalThis.fetch = original; raw.close(); }
});

test('an incomplete Drive download is rejected and does not publish an object', async () => {
 const { raw, objects, env } = fixture(); const original = globalThis.fetch;
 globalThis.fetch = async url => {
  if (String(url).includes('/drive/v3/files?')) return Response.json({ files: [{ id: 'truncated', name: 'bad.pdf', mimeType: 'application/pdf' }] });
  return new Response('%PDF-short', { headers: { 'Content-Length': '100' } });
 };
 try {
  for (let i = 0; i < 3; i++) await processDriveImports(env, async () => 'test-token');
  assert.equal(objects.size, 0);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 0);
  assert.equal(raw.prepare('SELECT state FROM drive_import_jobs').get().state, 'failed');
 } finally { globalThis.fetch = original; raw.close(); }
});

test('a concurrent removal prevents a Drive retry from restoring the deleted object', async () => {
 const { raw, objects, env } = fixture(); const originalFetch = globalThis.fetch;
 const createUpload = env.BUCKET.createMultipartUpload;
 env.BUCKET.createMultipartUpload = async key => {
  const upload = await createUpload(key), originalPart = upload.uploadPart;
  upload.uploadPart = async (number, stream) => {
   const result = await originalPart(number, stream);
   const id = key.slice('catalog/'.length);
   raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id,'race.pdf','pdf',1,key,'race-hash','Race',1);
   await removeStory(env.DB, id);
   await flushObjectDeletion(env.DB, env.BUCKET, key);
   return result;
  };
  return upload;
 };
 globalThis.fetch = async url => String(url).includes('/drive/v3/files?')
  ? Response.json({ files: [{ id: 'race-file', name: 'race.pdf', mimeType: 'application/pdf' }] })
  : new Response('%PDF-race', { headers: { 'Content-Length': '9' } });
 try {
  for (let i = 0; i < 3; i++) await processDriveImports(env, async () => 'test-token');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM shared_stories').get().n, 0);
  assert.equal(objects.size, 0);
  assert.ok(raw.prepare('SELECT deleted_at FROM object_deletions').get().deleted_at);
  assert.equal(raw.prepare('SELECT state FROM drive_import_jobs').get().state, 'done');
 } finally { globalThis.fetch = originalFetch; raw.close(); }
});

test('advancing a selected job never resumes unrelated stale jobs', async () => {
 const { raw, env } = fixture(); const original = globalThis.fetch;
 raw.prepare('INSERT INTO drive_import_jobs (id,user_id,created_at) VALUES (?,?,?)').run('old','admin',2);
 raw.prepare('INSERT INTO drive_import_items (id,job_id,drive_id,name,mime_type,state,updated_at) VALUES (?,?,?,?,?,?,?)').run('old-item','old','old-root','Old','application/vnd.google-apps.folder','processing',1);
 globalThis.fetch = async () => Response.json({files:[]});
 try {
  await processDriveImports(env, async () => 'token', 1, 'job');
  assert.equal(raw.prepare("SELECT state FROM drive_import_items WHERE id = 'root-item'").get().state, 'done');
  assert.equal(raw.prepare("SELECT state FROM drive_import_items WHERE id = 'old-item'").get().state, 'processing');
 } finally { globalThis.fetch = original; raw.close(); }
});

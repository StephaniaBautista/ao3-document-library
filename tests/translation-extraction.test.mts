import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { processTranslationExtraction } from '../lib/catalog/translation-extractor';
import { processTranslationSegments } from '../lib/catalog/translation';

test('background extraction prepares a whole story, prioritizes the first segment, and completes the remaining translations', async () => {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const directory = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, directory), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','User','test@example.com',1,1,1);
 raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)').run('s','s.pdf','pdf',1,'key','hash','Story',1);
 raw.prepare('INSERT INTO translation_jobs (id,user_id,story_id,target_language,created_at) VALUES (?,?,?,?,?)').run('j','u','s','es',1);
 function prepare(sql: string) { function bound(values: unknown[]): object { return { bind: (...args: unknown[]) => bound(args), run: async () => ({ meta: { changes: raw.prepare(sql).run(...values as []).changes } }), first: async () => raw.prepare(sql).get(...values as []) ?? null, all: async () => ({ results: raw.prepare(sql).all(...values as []) }), execute: () => raw.prepare(sql).run(...values as []) }; } return bound([]); }
 const db = { prepare, batch: async (statements: { execute: () => unknown }[]) => { raw.exec('BEGIN'); try { for (const statement of statements) statement.execute(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; } } } as unknown as D1Database;
 const env = { DB: db, BUCKET: { get: async () => ({ size: 8, arrayBuffer: async () => new TextEncoder().encode('%PDF-test').buffer }) } as unknown as R2Bucket, EXTRACTOR_URL: 'https://extractor.example', EXTRACTOR_TOKEN: 'test', GOOGLE_TRANSLATE_API_KEY: 'test' };
 const original = globalThis.fetch; const events: string[] = [];
 globalThis.fetch = async input => {
  if (String(input).includes('/extract-first')) { events.push('first'); return Response.json({ pages: ['The first chapter contains enough text.'] }); }
  if (String(input).includes('/extract-range')) { events.push('range'); return Response.json({ start: 1, total: 2, pages: ['The second chapter contains enough text.'] }); }
  events.push('translate'); return Response.json({ data: { translations: [{ translatedText: 'Texto traducido' }] } });
 };
 try {
  await processTranslationExtraction(env, 1);
  assert.deepEqual(events.slice(0, 3), ['first', 'translate', 'range']);
  assert.equal((raw.prepare('SELECT extraction_state FROM translation_jobs').get() as { extraction_state: string }).extraction_state, 'done');
  assert.deepEqual(raw.prepare('SELECT state FROM translation_segments ORDER BY position').all().map(row => row.state), ['done', 'pending']);
  await processTranslationSegments(env, 'j', 10);
  assert.deepEqual(raw.prepare('SELECT state FROM translation_segments ORDER BY position').all().map(row => row.state), ['done', 'done']);
 } finally { globalThis.fetch = original; raw.close(); }
});

test('an unavailable EPUB section fails honestly after preserving earlier sections and can resume', async () => {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const directory = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, directory), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','User','test@example.com',1,1,1);
 raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)').run('s','s.epub','epub',1,'key','hash','Story',1);
 raw.prepare('INSERT INTO translation_jobs (id,user_id,story_id,target_language,created_at) VALUES (?,?,?,?,?)').run('j','u','s','es',1);
 function prepare(sql: string) { function bound(values: unknown[]): object { return { bind: (...args: unknown[]) => bound(args), run: async () => ({ meta: { changes: raw.prepare(sql).run(...values as []).changes } }), first: async () => raw.prepare(sql).get(...values as []) ?? null, all: async () => ({ results: raw.prepare(sql).all(...values as []) }), execute: () => ({ meta: { changes: raw.prepare(sql).run(...values as []).changes } }) }; } return bound([]); }
 const db = { prepare, batch: async (statements: { execute: () => unknown }[]) => { raw.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); raw.exec('COMMIT'); return results; } catch (error) { raw.exec('ROLLBACK'); throw error; } } } as unknown as D1Database;
 const env = { DB:db, BUCKET:{ get:async()=>({ size:8, arrayBuffer:async()=>new TextEncoder().encode('EPUBtest').buffer }) } as unknown as R2Bucket, EXTRACTOR_URL:'https://extractor.example', EXTRACTOR_TOKEN:'test', GOOGLE_TRANSLATE_API_KEY:'test' };
 const original = globalThis.fetch; let fixed = false, unavailable = false; const rangeAttempts: number[] = [];
 globalThis.fetch = async input => {
  const url = new URL(String(input));
  if (url.pathname === '/extract-first') return Response.json({ pages:['Section zero has readable text.'] });
  if (url.pathname === '/extract-range') {
   const start=Number(url.searchParams.get('start')), limit=Number(url.searchParams.get('limit'));
   rangeAttempts.push(limit);
   if (unavailable) return new Response(null,{status:503});
   if (!fixed && start <= 3 && start + limit > 3) return new Response(null,{status:422});
   return Response.json({ start, total:5, pages:Array.from({length:Math.min(limit,5-start)},(_,i)=>`Section ${start+i} has readable text.`) });
  }
  return Response.json({ data:{ translations:[{ translatedText:'Texto traducido' }] } });
 };
 try {
  await processTranslationExtraction(env,1); await processTranslationExtraction(env,1); await processTranslationExtraction(env,1);
  let job = raw.prepare('SELECT extraction_state AS state, extraction_next_page AS page FROM translation_jobs WHERE id = ?').get('j') as {state:string;page:number};
  assert.deepEqual({ ...job },{state:'failed',page:3});
  assert.deepEqual(raw.prepare('SELECT position FROM translation_segments ORDER BY position').all().map(row=>row.position),[0,1,2]);
  unavailable = true; rangeAttempts.length = 0; raw.prepare("UPDATE translation_jobs SET extraction_state = 'pending' WHERE id = 'j'").run();
  await processTranslationExtraction(env,1);
  assert.deepEqual(rangeAttempts,[10]);
  job = raw.prepare('SELECT extraction_state AS state, extraction_next_page AS page FROM translation_jobs WHERE id = ?').get('j') as typeof job;
  assert.deepEqual({ ...job },{state:'failed',page:3});
  unavailable = false;
  fixed = true; raw.prepare("UPDATE translation_jobs SET extraction_state = 'pending' WHERE id = 'j'").run();
  await processTranslationExtraction(env,1);
  job = raw.prepare('SELECT extraction_state AS state, extraction_next_page AS page FROM translation_jobs WHERE id = ?').get('j') as typeof job;
  assert.deepEqual({ ...job },{state:'done',page:5});
  assert.deepEqual(raw.prepare('SELECT position FROM translation_segments ORDER BY position').all().map(row=>row.position),[0,1,2,3,4]);
 } finally { globalThis.fetch=original; raw.close(); }
});

test('scanned documents resume by page after an OCR failure without losing or duplicating text', async () => {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const directory = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, directory), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','User','test@example.com',1,1,1);
 raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)').run('s','s.pdf','pdf',1,'key','hash','Story',1);
 raw.prepare('INSERT INTO translation_jobs (id,user_id,story_id,target_language,created_at) VALUES (?,?,?,?,?)').run('j','u','s','es',1);
 function prepare(sql: string) { function bound(values: unknown[]): object { return { bind: (...args: unknown[]) => bound(args), run: async () => ({ meta: { changes: raw.prepare(sql).run(...values as []).changes } }), first: async () => raw.prepare(sql).get(...values as []) ?? null, all: async () => ({ results: raw.prepare(sql).all(...values as []) }), execute: () => raw.prepare(sql).run(...values as []) }; } return bound([]); }
 const db = { prepare, batch: async (statements: { execute: () => unknown }[]) => { raw.exec('BEGIN'); try { for (const statement of statements) statement.execute(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; } } } as unknown as D1Database;
 const env = { DB: db, BUCKET: { get: async () => ({ size: 8, arrayBuffer: async () => new TextEncoder().encode('%PDF-test').buffer }) } as unknown as R2Bucket, EXTRACTOR_URL: 'https://extractor.example', EXTRACTOR_TOKEN: 'test', GOOGLE_TRANSLATE_API_KEY: 'test' };
 const original = globalThis.fetch, ocrPages: number[] = []; let failOnce = true;
 globalThis.fetch = async (input, init) => {
  if (String(input).includes('/extract-first')) return Response.json({ pages: [''] });
  if (String(input).includes('/extract-range')) { const start = Number(new URL(String(input)).searchParams.get('start')); return Response.json({ start, total: 25, pages: Array(Math.min(10, 25 - start)).fill('') }); }
  if (String(input).includes('/ocr-pdf?page=')) {
   const page = Number(new URL(String(input)).searchParams.get('page')); ocrPages.push(page);
   if (page === 12 && failOnce) { failOnce = false; return new Response(null, { status: 503 }); }
   return Response.json({ text: `This is the complete text of scanned page ${page}.` });
  }
  return Response.json({ data: { translations: [{ translatedText: 'Texto traducido' }] } });
 };
 try {
  await processTranslationExtraction(env, 1);
  let job = raw.prepare('SELECT extraction_state AS state, extraction_next_page AS page, extraction_next_position AS position FROM translation_jobs').get() as { state: string; page: number; position: number };
  assert.deepEqual({ ...job }, { state: 'pending', page: 10, position: 10 });
  assert.equal((raw.prepare('SELECT state FROM translation_segments WHERE position = 0').get() as { state: string }).state, 'done');
  await processTranslationExtraction(env, 1);
  job = raw.prepare('SELECT extraction_state AS state, extraction_next_page AS page, extraction_next_position AS position FROM translation_jobs').get() as typeof job;
  assert.deepEqual({ ...job }, { state: 'failed', page: 11, position: 11 });
  raw.prepare('INSERT INTO translation_segments (id, job_id, position, source_text, updated_at) VALUES (?,?,?,?,?)').run('stale', 'j', 11, 'incomplete stale page', 1);
  raw.prepare("UPDATE translation_jobs SET extraction_state = 'pending' WHERE id = 'j'").run();
  await processTranslationExtraction(env, 1);
  await processTranslationExtraction(env, 1);
  job = raw.prepare('SELECT extraction_state AS state, extraction_next_page AS page, extraction_next_position AS position FROM translation_jobs').get() as typeof job;
  assert.deepEqual({ ...job }, { state: 'done', page: 25, position: 25 });
  const rows = raw.prepare('SELECT position, source_text FROM translation_segments ORDER BY position').all();
  assert.equal(rows.length, 25);
  for (let i = 0; i < 25; i++) { assert.equal(rows[i].position, i); assert.equal(rows[i].source_text, `This is the complete text of scanned page ${i + 1}.`); }
  assert.equal(ocrPages.filter(page => page === 11).length, 1);
  assert.equal(ocrPages.filter(page => page === 12).length, 2);
  raw.prepare('DELETE FROM translation_segments WHERE job_id = ?').run('j');
  raw.prepare("UPDATE translation_jobs SET extraction_state = 'pending', extraction_next_page = 0, extraction_next_position = 0 WHERE id = ?").run('j');
  globalThis.fetch = async input => {
   if (String(input).includes('/extract-first')) return Response.json({ pages: [''] });
   if (String(input).includes('/ocr-pdf?page=')) {
    raw.prepare("UPDATE translation_jobs SET browser_claim = 'new-claim' WHERE id = ?").run('j');
    return Response.json({ text: 'The old worker must not save this page.' });
   }
   throw new Error('Unexpected request');
  };
  await processTranslationExtraction(env, 1);
  assert.equal((raw.prepare('SELECT count(*) AS count FROM translation_segments').get() as { count: number }).count, 0);
  const current = raw.prepare('SELECT extraction_state, browser_claim, extraction_next_page FROM translation_jobs').get() as { extraction_state: string; browser_claim: string; extraction_next_page: number };
  assert.equal(current.extraction_state, 'processing'); assert.equal(current.browser_claim, 'new-claim'); assert.equal(current.extraction_next_page, 0);
 } finally { globalThis.fetch = original; raw.close(); }
});

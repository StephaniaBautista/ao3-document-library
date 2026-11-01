import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { getTranslationWindow } from '../lib/catalog/translation-window.ts';

test('long translations return one private fragment with progress and navigation', async () => {
 const raw = new DatabaseSync(':memory:');
 const dir = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, dir), 'utf8'));
 const user = raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)');
 user.run('u','User','u@example.invalid',1,1,1); user.run('other','Other','other@example.invalid',1,1,1);
 raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)').run('s','s.pdf','pdf',1,'key','hash','Story',1);
 raw.prepare('INSERT INTO translation_jobs (id,user_id,story_id,target_language,created_at,extraction_state,reading_position) VALUES (?,?,?,?,?,?,?)').run('j','u','s','es',1,'done',500);
 const add = raw.prepare('INSERT INTO translation_segments (id,job_id,position,source_text,translated_text,state,updated_at) VALUES (?,?,?,?,?,?,?)');
 for (let i = 0; i < 1000; i++) add.run(`segment-${i}`,'j',i,'Source',i < 800 ? `Translation ${i}` : null,i < 800 ? 'done' : i === 800 ? 'failed' : 'pending',1);
 const db = { prepare: sql => ({ bind: (...values) => ({ first: async () => raw.prepare(sql).get(...values) ?? null }) }) };
 try {
  assert.equal(await getTranslationWindow(db,'other','j',null), null);
  const saved = await getTranslationWindow(db,'u','j',null);
  assert.equal(saved.segment.position,500); assert.equal(saved.segment.translatedText,'Translation 500');
  assert.equal(saved.previousPosition,499); assert.equal(saved.nextPosition,501);
  assert.deepEqual([saved.total,saved.completed,saved.failed],[1000,800,1]);
  const first = await getTranslationWindow(db,'u','j',0);
  assert.equal(first.previousPosition,null); assert.equal(first.nextPosition,1);
  const last = await getTranslationWindow(db,'u','j',999);
  assert.equal(last.previousPosition,998); assert.equal(last.nextPosition,null); assert.equal(last.segment.translatedText,null);
  raw.prepare('DELETE FROM translation_segments WHERE job_id = ? AND position = ?').run('j',500);
  const gap = await getTranslationWindow(db,'u','j',500);
  assert.equal(gap.segment.position,501); assert.equal(gap.previousPosition,499);
  raw.prepare("UPDATE translation_jobs SET extraction_state = 'processing' WHERE id = 'j'").run();
  const incomplete = await getTranslationWindow(db,'u','j',null);
  assert.equal(incomplete.segment,null); assert.equal(incomplete.readingPosition,500);
  add.run('restored-500','j',500,'Source','Restored','done',1);
  const resumed = await getTranslationWindow(db,'u','j',null);
  assert.equal(resumed.segment.position,500); assert.equal(resumed.segment.translatedText,'Restored');
 } finally { raw.close(); }
});

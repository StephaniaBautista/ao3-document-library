import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { saveTranslationPosition } from '../lib/catalog/translation-position.ts';

test('translated reading positions are private, language-specific and bound to existing fragments', async () => {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const dir = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, dir), 'utf8'));
 const user = raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)');
 user.run('u','User','u@example.invalid',1,1,1); user.run('other','Other','other@example.invalid',1,1,1);
 raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)').run('s','s.pdf','pdf',1,'key','hash','Story',1);
 const job = raw.prepare('INSERT INTO translation_jobs (id,user_id,story_id,target_language,created_at) VALUES (?,?,?,?,?)');
 job.run('es','u','s','es',1); job.run('fr','u','s','fr',1); job.run('other-es','other','s','es',1);
 const segment = raw.prepare('INSERT INTO translation_segments (id,job_id,position,source_text,updated_at) VALUES (?,?,?,?,?)');
 for (const id of ['es','fr','other-es']) { segment.run(`${id}-0`,id,0,'first',1); segment.run(`${id}-1`,id,1,'second',1); }
 const db = { prepare: sql => ({ bind: (...values) => ({ first: async () => raw.prepare(sql).get(...values) ?? null }) }) };
 try {
  assert.equal(await saveTranslationPosition(db,'u','es',1), true);
  assert.equal(await saveTranslationPosition(db,'other','es',0), false);
  assert.equal(await saveTranslationPosition(db,'u','es',5), false);
  assert.equal(await saveTranslationPosition(db,'u','es',-1), false);
  assert.equal(await saveTranslationPosition(db,'u','es',1.5), false);
  const positions = Object.fromEntries(raw.prepare('SELECT id,reading_position FROM translation_jobs').all().map(row => [row.id,row.reading_position]));
  assert.deepEqual(positions, { es: 1, fr: 0, 'other-es': 0 });
  raw.prepare('DELETE FROM user WHERE id = ?').run('u');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM translation_jobs WHERE user_id = ?').get('u').n, 0);
  assert.ok(raw.prepare('SELECT id FROM shared_stories WHERE id = ?').get('s'));
 } finally { raw.close(); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { splitTranslationText } from '../lib/catalog/extract-text.ts';
import { translateText, processTranslationSegments } from '../lib/catalog/translation.ts';

function fixture() {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 for (const name of ['0000_lush_magdalene.sql','0001_tough_stephen_strange.sql','0002_high_power_pack.sql','0003_gigantic_jigsaw.sql','0004_busy_tattoo.sql','0005_volatile_blackheart.sql','0006_far_dazzler.sql','0007_messy_tarot.sql','0008_certain_maddog.sql','0009_slow_ozymandias.sql','0010_shallow_tusk.sql','0011_lazy_ma_gnuci.sql', '0012_lumpy_blue_blade.sql', '0013_silky_doomsday.sql', '0014_perfect_ravenous.sql', '0015_low_drax.sql', '0016_polite_human_fly.sql', '0017_grey_fat_cobra.sql', '0018_sharp_blockbuster.sql', '0019_amused_bishop.sql', '0020_left_human_fly.sql', '0021_nebulous_secret_warriors.sql', '0022_sweet_madame_hydra.sql', '0023_brave_overlord.sql', '0024_spotty_barracuda.sql', '0025_flimsy_victor_mancha.sql', '0026_early_mentallo.sql', '0027_married_mojo.sql', '0028_slow_xorn.sql', '0029_round_imperial_guard.sql', '0030_mute_raza.sql', '0031_ordinary_tusk.sql', '0032_fearless_alex_power.sql']) raw.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'));
 function prepare(sql) { function bound(values) { return { bind: (...args) => bound(args), run: async () => raw.prepare(sql).run(...values), first: async () => raw.prepare(sql).get(...values) ?? null, all: async () => ({ results: raw.prepare(sql).all(...values) }), execute: () => raw.prepare(sql).run(...values) }; } return bound([]); }
 return { raw, env: { DB: { prepare, batch: async statements => { raw.exec('BEGIN'); try { for (const statement of statements) statement.execute(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; } } }, GOOGLE_TRANSLATE_API_KEY: 'test' } };
}
test('long text splits without cutting surrogate pairs or losing non-space content', () => {
 const value = 'a'.repeat(4499) + '😀' + 'b'.repeat(5000);
 const parts = splitTranslationText(value);
 assert.equal(parts.join(''), value);
 assert.ok(parts.every(part => part.length <= 4500));
});
test('translations are cached and independent of users for the same text and language', async () => {
 const { raw, env } = fixture(), original = globalThis.fetch; let calls = 0;
 raw.prepare('INSERT INTO shared_stories (id, filename, file_type, size, object_key, content_hash, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('s', 's.pdf', 'pdf', 1, 'key', 'hash', 'Story', 1);
 globalThis.fetch = async () => { calls++; return Response.json({ data: { translations: [{ translatedText: 'Hola &amp; adiós' }] } }); };
 try {
  assert.equal(await translateText(env, 'Hello', 'es', 's'), 'Hola & adiós');
  assert.equal(await translateText(env, 'Hello', 'es', 's'), 'Hola & adiós');
  assert.equal(calls, 1);
 } finally { globalThis.fetch = original; raw.close(); }
});
test('failed translation remains retryable and never appears as completed', async () => {
 const { raw, env } = fixture(), original = globalThis.fetch;
 raw.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('u', 'User', 'test@example.com', 1, 1, 1);
 raw.prepare('INSERT INTO shared_stories (id, filename, file_type, size, object_key, content_hash, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('s', 's.pdf', 'pdf', 1, 'key', 'hash', 'Story', 1);
 raw.prepare('INSERT INTO translation_jobs (id, user_id, story_id, target_language, created_at) VALUES (?, ?, ?, ?, ?)').run('j', 'u', 's', 'es', 1);
 raw.prepare('INSERT INTO translation_segments VALUES (?, ?, ?, ?, ?, ?, ?)').run('segment', 'j', 0, 'Hello', null, 'pending', 1);
 globalThis.fetch = async () => new Response('failed', { status: 503 });
 try {
  await processTranslationSegments(env, 'j', 1);
  assert.equal(raw.prepare('SELECT state FROM translation_segments').get().state, 'failed');
 } finally { globalThis.fetch = original; raw.close(); }
});

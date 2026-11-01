import { decodeTextEntities } from './entities.mjs';
type TranslationEnv = Pick<Cloudflare.Env, 'DB' | 'GOOGLE_TRANSLATE_API_KEY'>;
type Segment = { id: string; sourceText: string; targetLanguage: string; storyId: string };
const toHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');

export async function translateText(env: TranslationEnv, text: string, target: string, storyId: string): Promise<string> {
 if (!env.DB || !env.GOOGLE_TRANSLATE_API_KEY) throw new Error('Translation unavailable');
 const digest = toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${target}\0${text}`)));
 const cached = await env.DB.prepare('SELECT translated_text AS translatedText FROM translation_cache WHERE id = ?').bind(digest).first<{ translatedText: string }>();
 if (cached) {
  await env.DB.prepare('INSERT OR IGNORE INTO translation_cache_refs (id, cache_id, story_id) VALUES (?, ?, ?)').bind(crypto.randomUUID(), digest, storyId).run();
  return cached.translatedText;
 }
 const res = await fetch('https://translation.googleapis.com/language/translate/v2', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GOOGLE_TRANSLATE_API_KEY },
  body: JSON.stringify({ q: text, target, format: 'text' }), redirect: 'manual', signal: AbortSignal.timeout(20000),
 });
 if (!res.ok) throw new Error('Translation service unavailable');
 const data = await res.json() as { data?: { translations?: { translatedText?: unknown }[] } };
 const raw = data.data?.translations?.[0]?.translatedText;
 if (typeof raw !== 'string') throw new Error('Invalid translation response');
 const translated = decodeTextEntities(raw);
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO translation_cache (id, target_language, translated_text, created_at) VALUES (?, ?, ?, ?)').bind(digest, target, translated, Date.now()),
  env.DB.prepare('INSERT OR IGNORE INTO translation_cache_refs (id, cache_id, story_id) VALUES (?, ?, ?)').bind(crypto.randomUUID(), digest, storyId),
 ]);
 return translated;
}

export async function processTranslationSegments(env: TranslationEnv, jobId?: string, limit = 10) {
 if (!env.DB || !env.GOOGLE_TRANSLATE_API_KEY) return;
 const db = env.DB;
 await db.prepare("UPDATE translation_segments SET state = 'pending', updated_at = ? WHERE state = 'processing' AND updated_at < ?").bind(Date.now(), Date.now() - 600_000).run();
 const sql = "SELECT s.id, s.source_text AS sourceText, j.target_language AS targetLanguage, j.story_id AS storyId FROM translation_segments s JOIN translation_jobs j ON j.id = s.job_id WHERE s.state = 'pending'" + (jobId ? ' AND j.id = ?' : '') + ' ORDER BY j.created_at, s.position LIMIT ?';
 const rows = jobId ? await db.prepare(sql).bind(jobId, limit).all<Segment>() : await db.prepare(sql).bind(limit).all<Segment>();
 for (const segment of rows.results) {
  const claimed = await db.prepare("UPDATE translation_segments SET state = 'processing', updated_at = ? WHERE id = ? AND state = 'pending' RETURNING id").bind(Date.now(), segment.id).first();
  if (!claimed) continue;
  try {
   const translated = await translateText(env, segment.sourceText, segment.targetLanguage, segment.storyId);
   await db.prepare("UPDATE translation_segments SET translated_text = ?, state = 'done', updated_at = ? WHERE id = ? AND state = 'processing'").bind(translated, Date.now(), segment.id).run();
  } catch {
   await db.prepare("UPDATE translation_segments SET state = 'failed', updated_at = ? WHERE id = ? AND state = 'processing'").bind(Date.now(), segment.id).run();
  }
 }
}

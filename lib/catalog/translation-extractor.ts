import { ocrPdfPage, ocrLargePdfPage } from './xiaomi-ocr';
import { processTranslationSegments } from './translation';
import { splitTranslationText } from './text-chunks.mjs';
import { largeExtractionRequest } from './extractor-request';
import { requeueStaleExtractions } from './browser-extraction';
type Env = Pick<Cloudflare.Env, 'DB' | 'BUCKET' | 'EXTRACTOR_URL' | 'EXTRACTOR_TOKEN' | 'GOOGLE_TRANSLATE_API_KEY' | 'BETTER_AUTH_URL'>;
type Job = { id: string; storyId: string; objectKey: string; fileType: 'pdf' | 'epub' };
class ExtractionResponseError extends Error {
 constructor(readonly status: number) { super('Text extraction failed'); }
}
export async function processTranslationExtraction(env: Env, limit = 2) {
 if (!env.DB || !env.BUCKET || !env.EXTRACTOR_URL || !env.EXTRACTOR_TOKEN) return;
 const target = new URL(env.EXTRACTOR_URL);
 if (target.protocol !== 'https:' && target.hostname !== 'localhost' && target.hostname !== '127.0.0.1') throw new Error('Invalid extractor URL');
 const db = env.DB;
 await requeueStaleExtractions(db);
 const jobs = await db.prepare("SELECT j.id, s.id AS storyId, s.object_key AS objectKey, s.file_type AS fileType FROM translation_jobs j JOIN shared_stories s ON s.id = j.story_id WHERE j.extraction_state = 'pending' ORDER BY COALESCE(j.extraction_claimed_at, 0), j.created_at, j.id LIMIT ?").bind(limit).all<Job>();
 for (const job of jobs.results) {
  const token = crypto.randomUUID(), startedAt = Date.now();
  const claim = await db.prepare("UPDATE translation_jobs SET extraction_state = 'processing', extraction_claimed_at = ?, browser_claim = ? WHERE id = ? AND extraction_state = 'pending' RETURNING extraction_next_page AS nextPage, extraction_next_position AS nextPosition").bind(startedAt, token, job.id).first<{ nextPage: number; nextPosition: number }>();
  if (!claim) continue;
  try {
   // Remove only the uncommitted tail of a page left by a previous attempt.
   await db.prepare("DELETE FROM translation_segments WHERE job_id = ? AND position >= ? AND EXISTS (SELECT 1 FROM translation_jobs WHERE id = ? AND extraction_state = 'processing' AND browser_claim = ?)").bind(job.id, claim.nextPosition, job.id, token).run();
   const object = await env.BUCKET.get(job.objectKey);
   if (!object) throw new Error('File unavailable');
   const large = object.size > 24 * 1024 * 1024;
   if (large) await object.body.cancel();
   const bytes = large ? null : await object.arrayBuffer();
   const extract = async (start: number | null, limit = 10) => {
    const body = large ? await largeExtractionRequest(env, job.storyId, job.fileType, object.size) : bytes;
    const path = start === null ? '/extract-first' : '/extract-range';
    const url = new URL(large ? `${path}-from-url` : path, target);
    if (start !== null) url.search = new URLSearchParams({ start: String(start), limit: String(limit) }).toString();
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${env.EXTRACTOR_TOKEN}`, 'Content-Type': large ? 'application/json' : job.fileType === 'pdf' ? 'application/pdf' : 'application/epub+zip' }, body, redirect: 'manual', signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new ExtractionResponseError(res.status);
    const payload = await res.json() as { pages?: unknown; start?: unknown; total?: unknown };
    if (!Array.isArray(payload.pages) || payload.pages.some(page => typeof page !== 'string')) throw new Error('Invalid text extraction response');
    if (start !== null && (payload.start !== start || !Number.isSafeInteger(payload.total) || Number(payload.total) < start || payload.pages.length !== Math.min(limit, Number(payload.total) - start))) throw new Error('Invalid text extraction range');
    return { pages: payload.pages as string[], total: start === null ? null : Number(payload.total) };
   };
   let position = claim.nextPosition, nextPage = claim.nextPage, firstQueued = false, pagesProcessed = 0;
   const savePage = async (original: string, i: number) => {
    if (i !== nextPage) throw new Error('Unexpected page');
    let text = original;
    if (job.fileType === 'pdf' && text.trim().length < 20) text = bytes ? await ocrPdfPage(env, bytes, i + 1) : await ocrLargePdfPage(env, job.storyId, object.size, i + 1);
    const chunks = splitTranslationText(text);
    for (let offset = 0; offset < chunks.length; offset += 50) {
     const statements = chunks.slice(offset, offset + 50).map(chunk => db.prepare("INSERT OR IGNORE INTO translation_segments (id, job_id, position, source_text, updated_at) SELECT ?, id, ?, ?, ? FROM translation_jobs WHERE id = ? AND extraction_state = 'processing' AND browser_claim = ?").bind(crypto.randomUUID(), position++, chunk, Date.now(), job.id, token));
     if (statements.length) await db.batch(statements);
    }
    const advanced = await db.prepare("UPDATE translation_jobs SET extraction_next_page = ?, extraction_next_position = ?, extraction_claimed_at = ? WHERE id = ? AND extraction_state = 'processing' AND browser_claim = ? AND extraction_next_page = ?").bind(i + 1, position, Date.now(), job.id, token, i).run();
    if (!advanced.meta.changes) throw new Error('Extraction claim lost');
    nextPage = i + 1; pagesProcessed++;
    if (!firstQueued && position) { firstQueued = true; await processTranslationSegments(env, job.id, 1); }
   };
   const first = nextPage === 0 ? (await extract(null)).pages : [];
   if (nextPage === 0 && !first.length) throw new Error('First section unavailable');
   for (let i = 0; i < first.length; i++) await savePage(first[i], i);
   const rangeStart = nextPage;
   // If a later EPUB section is broken, retain the readable sections before it
   // rather than losing the whole batch or treating the missing section as done.
   let range;
   try { range = await extract(rangeStart); }
   catch (error) { if (job.fileType !== 'epub' || !(error instanceof ExtractionResponseError) || error.status !== 422) throw error; range = await extract(rangeStart, 1); }
   for (let i = 0; i < range.pages.length && (pagesProcessed === 0 || (pagesProcessed < 10 && Date.now() - startedAt < 45_000)); i++) {
    await savePage(range.pages[i], rangeStart + i);
   }
   if (nextPage === range.total && !position) throw new Error('No text found');
   await db.prepare("UPDATE translation_jobs SET extraction_state = ?, extraction_claimed_at = ?, browser_claim = NULL WHERE id = ? AND extraction_state = 'processing' AND browser_claim = ?").bind(nextPage === range.total ? 'done' : 'pending', nextPage === range.total ? null : Date.now(), job.id, token).run();
  } catch {
   await db.prepare("UPDATE translation_jobs SET extraction_state = 'failed', extraction_claimed_at = NULL, browser_claim = NULL WHERE id = ? AND extraction_state = 'processing' AND browser_claim = ?").bind(job.id, token).run();
  }
 }
}

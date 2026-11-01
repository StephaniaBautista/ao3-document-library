import { parseAo3Header } from './metadata.mjs';
import { saveMetadata } from './metadata-store';
import { largeExtractionRequest } from './extractor-request';
import { ocrPdfPage, ocrLargePdfPage } from './xiaomi-ocr';
type MetadataEnv = Pick<Cloudflare.Env, 'DB' | 'BUCKET' | 'EXTRACTOR_URL' | 'EXTRACTOR_TOKEN' | 'BETTER_AUTH_URL'>;
type Story = { id: string; objectKey: string; fileType: 'pdf' | 'epub' };
export async function processMetadata(env: MetadataEnv, limit = 5) {
 if (!env.DB || !env.BUCKET || !env.EXTRACTOR_URL || !env.EXTRACTOR_TOKEN) return;
 const target = new URL(env.EXTRACTOR_URL);
 if (target.protocol !== 'https:' && target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') throw new Error('Invalid extractor URL');
 const db = env.DB;
 await db.prepare("UPDATE shared_stories SET metadata_status = 'pending', metadata_claimed_at = NULL WHERE metadata_status = 'processing' AND metadata_claimed_at < ?").bind(Date.now() - 600_000).run();
 const rows = await db.prepare("SELECT id, object_key AS objectKey, file_type AS fileType FROM shared_stories WHERE metadata_status = 'pending' AND file_type IN ('pdf', 'epub') ORDER BY created_at LIMIT ?").bind(limit).all<Story>();
 for (const story of rows.results) {
  const claimedAt = Date.now();
  const claimed = await db.prepare("UPDATE shared_stories SET metadata_status = 'processing', metadata_claimed_at = ? WHERE id = ? AND metadata_status = 'pending' RETURNING id").bind(claimedAt, story.id).first();
  if (!claimed) continue;
  try {
   const object = await env.BUCKET.get(story.objectKey);
   if (!object) throw new Error('File unavailable');
   const large = object.size > 24 * 1024 * 1024;
   if (large) await object.body.cancel();
   const bytes = large ? null : await object.arrayBuffer();
   const body = large ? await largeExtractionRequest(env, story.id, story.fileType, object.size) : bytes;
   const response = await fetch(new URL(large ? '/extract-from-url' : '/extract', target), { method: 'POST', headers: { Authorization: `Bearer ${env.EXTRACTOR_TOKEN}`, 'Content-Type': large ? 'application/json' : story.fileType === 'pdf' ? 'application/pdf' : 'application/epub+zip' }, body, redirect: 'manual', signal: AbortSignal.timeout(180000) });
   if (!response.ok) throw new Error('Extraction unavailable');
   const payload = await response.json() as { text?: unknown; metadata?: { title?: unknown; creator?: unknown; description?: unknown; language?: unknown } };
   if (typeof payload.text !== 'string' || payload.text.length > 100000) throw new Error('Invalid extraction response');
   let text = payload.text;
   if (story.fileType === 'pdf' && text.trim().length < 20) text = bytes ? await ocrPdfPage(env, bytes) : await ocrLargePdfPage(env, story.id, object.size);
   const parsed = parseAo3Header(text);
   // Plain PDF text does not retain the boundary between summary and story.
   // Never overwrite a reliable imported summary with that ambiguous text.
   if (story.fileType === 'pdf') delete parsed.summary;
   const metadata = { ...parsed, title: parsed.title || payload.metadata?.title, author: parsed.author || payload.metadata?.creator, summary: parsed.summary || payload.metadata?.description, language: parsed.language || payload.metadata?.language };
   await saveMetadata(db, env.BUCKET, story.id, metadata, 'processing', claimedAt);
  } catch {
   await db.prepare("UPDATE shared_stories SET metadata_status = 'failed', metadata_claimed_at = NULL WHERE id = ? AND metadata_status = 'processing' AND metadata_claimed_at = ?").bind(story.id, claimedAt).run();
  }
 }
}

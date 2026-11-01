import { env } from 'cloudflare:workers';
import { catalogAccess } from '@/lib/catalog/access';
import { largeExtractionRequest } from '@/lib/catalog/extractor-request';
import { ocrLargePdfPage, ocrPdfPage } from '@/lib/catalog/xiaomi-ocr';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const raw = new URL(req.url).searchParams.get('page') || '0';
 if (!/^\d{1,6}$/.test(raw)) return Response.json({ error: "Invalid page." }, { status: 400 });
 const page = Number(raw), { id } = await params;
 const story = await access.context.db.prepare('SELECT object_key AS objectKey, file_type AS fileType, size, language FROM shared_stories WHERE id = ?').bind(id).first<{ objectKey: string; fileType: 'pdf' | 'epub' | 'html'; size: number; language: string | null }>();
 if (!story) return Response.json({ error: 'Story not found.' }, { status: 404 });
 if (!['pdf', 'epub', 'html'].includes(story.fileType) || !env.EXTRACTOR_URL || !env.EXTRACTOR_TOKEN) return Response.json({ error: "The reader is not available yet." }, { status: 503 });
 try {
  const target = new URL(env.EXTRACTOR_URL);
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname))) throw new Error('Invalid extractor');
  const large = story.size > 24 * 1024 * 1024;
  let bytes: ArrayBuffer | null = null;
  if (!large) {
   const object = await access.context.bucket.get(story.objectKey);
   if (!object) return Response.json({ error: 'File not found.' }, { status: 404 });
   bytes = await object.arrayBuffer();
  }
  const body = large ? await largeExtractionRequest(env, id, story.fileType, story.size) : bytes!;
  const url = new URL(large ? '/extract-range-from-url' : '/extract-range', target);
  url.search = new URLSearchParams({ start: String(page), limit: '1', ...(story.fileType === 'pdf' ? { layout: '1' } : {}) }).toString();
  const contentType = large ? 'application/json' : story.fileType === 'pdf' ? 'application/pdf' : story.fileType === 'epub' ? 'application/epub+zip' : 'text/html';
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${env.EXTRACTOR_TOKEN}`, 'Content-Type': contentType }, body, redirect: 'manual', signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error('Extraction failed');
  const result = await response.json() as { pages?: unknown; start?: unknown; total?: unknown; layouts?: unknown; chapters?: unknown; anchors?: unknown };
  if (result.start !== page || !Number.isSafeInteger(result.total) || Number(result.total) < 1 || page >= Number(result.total) || !Array.isArray(result.pages) || result.pages.length !== 1 || typeof result.pages[0] !== 'string' || result.pages[0].length > 1000000) throw new Error('Invalid extraction');
  const chapters = Array.isArray(result.chapters) ? result.chapters.filter((item: unknown): item is { title: string; page: number; anchor?: string } => !!item && typeof item === 'object' && 'title' in item && typeof item.title === 'string' && item.title.length <= 200 && 'page' in item && Number.isSafeInteger(item.page) && Number(item.page) >= 0 && Number(item.page) < Number(result.total) && (!('anchor' in item) || (typeof item.anchor === 'string' && item.anchor.length > 0 && item.anchor.length <= 256))).slice(0, 500) : [];
  const anchors = Array.isArray(result.anchors) ? result.anchors.filter((item: unknown): item is { id: string; offset: number } => !!item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 256 && 'offset' in item && Number.isSafeInteger(item.offset) && Number(item.offset) >= 0 && Number(item.offset) <= (result.pages as string[])[0].length).slice(0, 5000) : [];
  let text = result.pages[0] as string;
  const pageLayout = story.fileType === 'pdf' && Array.isArray(result.layouts) ? result.layouts[0] as { blank?: unknown } | null : null;
  const blank = pageLayout?.blank === true && !text.trim();
  const needsOcr = story.fileType === 'pdf' && text.trim().length < 20 && !blank;
  if (needsOcr) text = large ? await ocrLargePdfPage(env, id, story.size, page + 1) : await ocrPdfPage(env, bytes!, page + 1);
  return Response.json({ text, page, total: result.total, language: story.language, chapters, anchors, layout: !needsOcr ? pageLayout : null }, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
 } catch {
  return Response.json({ error: "Could not prepare this page. Check that the extractor and OCR are available." }, { status: 503 });
 }
}

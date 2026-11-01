import { env } from 'cloudflare:workers';
import { catalogAccess } from '@/lib/catalog/access';
import { ocrImage } from '@/lib/catalog/xiaomi-ocr';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (!env.EXTRACTOR_URL || !env.EXTRACTOR_TOKEN) return Response.json({ error: 'OCR is not configured yet.' }, { status: 503 });
 const length = Number(req.headers.get('content-length') || 0);
 if (length > 8 * 1024 * 1024) return Response.json({ error: 'Image exceeds the processing limit.' }, { status: 413 });
 let body: { image?: unknown };
 try {
  if (!req.body) throw new Error('Missing body');
  const reader = req.body.getReader(), decoder = new TextDecoder();
  let json = '';
  let size = 0;
  for (;;) {
   const { value, done } = await reader.read();
   if (done) break;
   size += value.byteLength;
   if (size > 8 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: 'Image exceeds the processing limit.' }, { status: 413 }); }
   json += decoder.decode(value, { stream: true });
  }
  body = JSON.parse(json + decoder.decode()) as { image?: unknown };
 } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
 if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid request.' }, { status: 400 });
 if (typeof body.image !== 'string' || body.image.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image)) return Response.json({ error: 'Invalid image.' }, { status: 400 });
 try {
  const binary = atob(body.image);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const text = await ocrImage(env, bytes);
  return Response.json({ text }, { headers: { 'Cache-Control': 'no-store' } });
 } catch { return Response.json({ error: 'Could not process the scanned page.' }, { status: 503 }); }
}

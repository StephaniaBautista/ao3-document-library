import { env } from 'cloudflare:workers';
import { catalogAccess } from '@/lib/catalog/access';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const { id } = await params;
 const story = await access.context.db.prepare('SELECT id FROM shared_stories WHERE id = ?').bind(id).first();
 if (!story) return Response.json({ error: 'Story not found.' }, { status: 404 });
 const lengthHeader = req.headers.get('content-length');
 if (lengthHeader && (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > 100000)) return Response.json({ error: 'Request too large.' }, { status: 400 });
 let body: { texts?: unknown };
 try {
  if (!req.body) throw new Error('No body');
  const reader = req.body.getReader(), decoder = new TextDecoder(); let text = '', size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 100000) { await reader.cancel(); throw new Error('Too large'); } text += decoder.decode(value, { stream: true }); }
  body = JSON.parse(text + decoder.decode());
 } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
 if (!body || typeof body !== 'object' || !Array.isArray(body.texts) || body.texts.length < 1 || body.texts.length > 128 || body.texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 1000)) return Response.json({ error: "Invalid text." }, { status: 400 });
 const config = env as Cloudflare.Env & { LOCAL_TRANSLATION_URL?: string };
 let url = config.LOCAL_TRANSLATION_URL;
 if (!url && env.EXTRACTOR_URL) {
  try { const extractor = new URL(env.EXTRACTOR_URL); if (extractor.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(extractor.hostname)) url = 'http://127.0.0.1:8766'; } catch { /* Invalid extractor configuration. */ }
 }
 if (!url || !env.EXTRACTOR_TOKEN) return Response.json({ error: "The local translator is not configured yet." }, { status: 503 });
 try {
  const target = new URL(url);
  if (target.username || target.password || target.search || target.hash || (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname)))) throw new Error('Invalid translator URL');
  const response = await fetch(new URL('/translate', target), { method: 'POST', headers: { Authorization: `Bearer ${env.EXTRACTOR_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'en', target: 'es', texts: body.texts }), redirect: 'manual', signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error('Translation failed');
  const result = await response.json() as { texts?: unknown };
  if (!Array.isArray(result.texts) || result.texts.length !== body.texts.length || result.texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 4000)) throw new Error('Incomplete translation');
  return Response.json({ texts: result.texts }, { headers: { 'Cache-Control': 'private, no-store' } });
 } catch { return Response.json({ error: "The local translator is unavailable or could not complete this page." }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}

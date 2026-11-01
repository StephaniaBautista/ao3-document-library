import { env } from 'cloudflare:workers';
import { verifyExtractorTicket } from '@/lib/catalog/extractor-ticket';

export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const { id } = await params;
 const authorization = req.headers.get('authorization') || '';
 const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
 if (!env.DB || !env.BUCKET || !await verifyExtractorTicket(token, id, env.EXTRACTOR_TOKEN || '')) return new Response('Not found', { status: 404 });
 const story = await env.DB.prepare('SELECT object_key AS objectKey FROM shared_stories WHERE id = ?').bind(id).first<{ objectKey: string }>();
 if (!story) return new Response('Not found', { status: 404 });
 const object = await env.BUCKET.get(story.objectKey);
 if (!object) return new Response('Not found', { status: 404 });
 return new Response(object.body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(object.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

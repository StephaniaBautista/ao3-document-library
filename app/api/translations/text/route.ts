import { env } from 'cloudflare:workers';
import { catalogAccess } from '@/lib/catalog/access';
import { translateText } from '@/lib/catalog/translation';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (!env.GOOGLE_TRANSLATE_API_KEY) return Response.json({ error: 'Translation is not configured yet.' }, { status: 503 });
 let body: { text?: unknown; target?: unknown; storyId?: unknown };
 try { body = await req.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
 if (typeof body.storyId !== 'string' || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 5000 || typeof body.target !== 'string' || !/^(?=.{2,35}$)[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(body.target)) return Response.json({ error: 'Invalid translation request.' }, { status: 400 });
 if (!await access.context.db.prepare('SELECT id FROM shared_stories WHERE id = ?').bind(body.storyId).first()) return Response.json({ error: 'Story not found.' }, { status: 404 });
 try { return Response.json({ text: await translateText(env, body.text, body.target, body.storyId) }, { headers: { 'Cache-Control': 'no-store' } }); }
 catch { return Response.json({ error: 'Could not translate the text.' }, { status: 503 }); }
}

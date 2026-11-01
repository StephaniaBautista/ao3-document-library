import { catalogAccess } from '@/lib/catalog/access';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const { id } = await params;
 const row = await access.context.db.prepare('SELECT location FROM reading_positions WHERE user_id = ? AND story_id = ?').bind(access.context.userId, id).first<{ location: string }>();
 return Response.json({ location: row?.location || null }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const { id } = await params;
 let body: { location?: unknown };
 try { body = await req.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
 if (typeof body.location !== 'string' || !body.location.trim() || body.location.length > 1000) return Response.json({ error: 'Invalid position.' }, { status: 400 });
 if (!await access.context.db.prepare('SELECT id FROM shared_stories WHERE id = ?').bind(id).first()) return Response.json({ error: 'Story not found.' }, { status: 404 });
 await access.context.db.prepare('INSERT INTO reading_positions (id, user_id, story_id, location, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, story_id) DO UPDATE SET location = excluded.location, updated_at = excluded.updated_at').bind(crypto.randomUUID(), access.context.userId, id, body.location, Date.now()).run();
 return Response.json({ ok: true });
}

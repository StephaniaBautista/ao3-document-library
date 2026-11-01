import { catalogAccess } from '@/lib/catalog/access';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const row = await access.context.db.prepare('SELECT target_language AS language FROM reading_settings WHERE user_id = ?').bind(access.context.userId).first<{ language: string }>();
 return Response.json({ language: row?.language || 'es' }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function PUT(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 let body: { language?: unknown };
 try { body = await req.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
 if (typeof body.language !== 'string' || !/^(?=.{2,35}$)[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(body.language)) return Response.json({ error: 'Invalid language.' }, { status: 400 });
 await access.context.db.prepare('INSERT INTO reading_settings (user_id, target_language) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET target_language = excluded.target_language').bind(access.context.userId, body.language).run();
 return Response.json({ ok: true });
}

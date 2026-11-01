import { catalogAccess } from '@/lib/catalog/access';
export const dynamic = 'force-dynamic';
const defaults = { fontSize: 100, fontFamily: 'serif', lineHeight: '1.6', background: 'light' };
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const row = await access.context.db.prepare('SELECT font_size AS fontSize, font_family AS fontFamily, line_height AS lineHeight, background FROM reading_settings WHERE user_id = ?').bind(access.context.userId).first();
 return Response.json({ settings: row || defaults }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function PUT(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 let body: { fontSize?: unknown; fontFamily?: unknown; lineHeight?: unknown; background?: unknown };
 try { body = await req.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
 if (typeof body.fontSize !== 'number' || !Number.isInteger(body.fontSize) || body.fontSize < 70 || body.fontSize > 200 || !['serif', 'sans-serif', 'monospace'].includes(String(body.fontFamily)) || !['1.3', '1.6', '2'].includes(String(body.lineHeight)) || !['light', 'warm', 'night'].includes(String(body.background))) return Response.json({ error: 'Invalid settings.' }, { status: 400 });
 await access.context.db.prepare('INSERT INTO reading_settings (user_id, font_size, font_family, line_height, background) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET font_size = excluded.font_size, font_family = excluded.font_family, line_height = excluded.line_height, background = excluded.background').bind(access.context.userId, body.fontSize, body.fontFamily, body.lineHeight, body.background).run();
 return Response.json({ ok: true });
}

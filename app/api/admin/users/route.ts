import { catalogAccess } from '@/lib/catalog/access';
import { listAdminUsers, parseUserCursor } from '@/lib/catalog/users-query';
export const dynamic = 'force-dynamic';
const error = (message: string, status: number) => Response.json({ error: message }, { status });
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 const url = new URL(req.url);
 const search = (url.searchParams.get('search') || '').trim().slice(0, 120);
 const cursor = parseUserCursor(url.searchParams.get('afterTime'), url.searchParams.get('afterId'));
 if (cursor === false) return error('Invalid page cursor.', 400);
 return Response.json(await listAdminUsers(access.context.db, search, cursor), { headers: { 'Cache-Control': 'no-store' } });
}
export async function PATCH(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 let body: { userId?: unknown; role?: unknown; blocked?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.', 400); }
 if (typeof body.userId !== 'string' || body.userId === access.context.userId || (body.role !== undefined && body.role !== 'user' && body.role !== 'moderator') || (body.blocked !== undefined && typeof body.blocked !== 'boolean') || (body.role === undefined && body.blocked === undefined)) return error('Invalid account update.', 400);
 const db = access.context.db;
 if (!await db.prepare('SELECT id FROM user WHERE id = ?').bind(body.userId).first()) return error('Account not found.', 404);
 await db.prepare('INSERT OR IGNORE INTO library_profiles (user_id, created_at) VALUES (?, ?)').bind(body.userId, Date.now()).run();
 if (body.role !== undefined) await db.prepare('UPDATE library_profiles SET role = ? WHERE user_id = ?').bind(body.role, body.userId).run();
 if (body.blocked !== undefined) await db.prepare('UPDATE library_profiles SET blocked = ? WHERE user_id = ?').bind(body.blocked ? 1 : 0, body.userId).run();
 return Response.json({ ok: true });
}

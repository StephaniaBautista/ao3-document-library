import { catalogAccess } from '@/lib/catalog/access';
import { listReminders } from '@/lib/catalog/reminder-query';
import { parseUserCursor } from '@/lib/catalog/users-query';
export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const url = new URL(req.url), cursor = parseUserCursor(url.searchParams.get('afterTime'), url.searchParams.get('afterId'));
 if (cursor === false) return error('Invalid page cursor.');
 return Response.json(await listReminders(access.context.db, access.context.userId, cursor), { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 let body: { storyId?: unknown; action?: unknown; comment?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 if (typeof body.storyId !== 'string' || (body.action !== 'kudo' && body.action !== 'comment')) return error('Invalid reminder.');
 const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
 if (body.action === 'comment' && (!comment || comment.length > 10000)) return error('Enter a comment.');
 if (!await access.context.db.prepare('SELECT id FROM shared_stories WHERE id = ?').bind(body.storyId).first()) return error('Story not found.', 404);
 const id = crypto.randomUUID();
 await access.context.db.prepare('INSERT INTO reminders (id, user_id, story_id, action, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, access.context.userId, body.storyId, body.action, body.action === 'comment' ? comment : null, Date.now()).run();
 return Response.json({ id }, { status: 201 });
}
export async function DELETE(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 let body: { id?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 if (typeof body.id !== 'string') return error('Invalid reminder.');
 await access.context.db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').bind(body.id, access.context.userId).run();
 return Response.json({ ok: true });
}

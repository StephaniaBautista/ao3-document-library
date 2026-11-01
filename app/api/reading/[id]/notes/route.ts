import { catalogAccess } from '@/lib/catalog/access';
export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const { id } = await params;
 const notes = await access.context.db.prepare('SELECT id, location, text, created_at AS createdAt FROM reading_notes WHERE user_id = ? AND story_id = ? ORDER BY created_at DESC').bind(access.context.userId, id).all();
 return Response.json({ notes: notes.results }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const { id } = await params;
 let body: { location?: unknown; text?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 if (typeof body.location !== 'string' || !body.location.trim() || body.location.length > 1000 || (body.text !== undefined && (typeof body.text !== 'string' || body.text.length > 5000))) return error('Invalid note.');
 if (!await access.context.db.prepare('SELECT id FROM shared_stories WHERE id = ?').bind(id).first()) return error('Story not found.', 404);
 const noteId = crypto.randomUUID();
 await access.context.db.prepare('INSERT INTO reading_notes (id, user_id, story_id, location, text, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(noteId, access.context.userId, id, body.location, typeof body.text === 'string' ? body.text.trim() || null : null, Date.now()).run();
 return Response.json({ id: noteId }, { status: 201 });
}
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const { id } = await params;
 let body: { noteId?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 if (typeof body.noteId !== 'string') return error('Invalid note.');
 await access.context.db.prepare('DELETE FROM reading_notes WHERE id = ? AND user_id = ? AND story_id = ?').bind(body.noteId, access.context.userId, id).run();
 return Response.json({ ok: true });
}

import { catalogAccess } from '@/lib/catalog/access';
export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const { id } = await params;
 const owned = await access.context.db.prepare('SELECT id FROM favorite_collections WHERE id = ? AND user_id = ?').bind(id, access.context.userId).first();
 if (!owned) return error('Collection not found.', 404);
 const rows = await access.context.db.prepare('SELECT s.id, s.folder_id AS folderId, s.filename, s.file_type AS fileType, s.size, s.title, s.author, s.summary, s.fandom, s.relationship, s.tags, s.warnings, s.language, s.rating, s.category, s.characters, s.word_count AS wordCount, s.chapter_count AS chapterCount, s.total_chapters AS totalChapters, s.ao3_url AS ao3Url, s.created_at AS createdAt FROM shared_stories s JOIN favorite_items i ON i.story_id = s.id WHERE i.collection_id = ? ORDER BY s.title COLLATE NOCASE').bind(id).all();
 return Response.json({ stories: rows.results });
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const { id } = await params;
 let body: { storyId?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 if (typeof body.storyId !== 'string') return error('Invalid story.');
 const db = access.context.db;
 const owned = await db.prepare('SELECT id FROM favorite_collections WHERE id = ? AND user_id = ?').bind(id, access.context.userId).first();
 const story = await db.prepare('SELECT id FROM shared_stories WHERE id = ?').bind(body.storyId).first();
 if (!owned || !story) return error('Collection or story not found.', 404);
 await db.prepare('INSERT OR IGNORE INTO favorite_items (id, collection_id, story_id, created_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), id, body.storyId, Date.now()).run();
 return Response.json({ ok: true });
}
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const { id } = await params;
 let body: { storyId?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 if (typeof body.storyId !== 'string') return error('Invalid story.');
 const db = access.context.db;
 const owned = await db.prepare('SELECT id FROM favorite_collections WHERE id = ? AND user_id = ?').bind(id, access.context.userId).first();
 if (!owned) return error('Collection not found.', 404);
 await db.prepare('DELETE FROM favorite_items WHERE collection_id = ? AND story_id = ?').bind(id, body.storyId).run();
 return Response.json({ ok: true });
}

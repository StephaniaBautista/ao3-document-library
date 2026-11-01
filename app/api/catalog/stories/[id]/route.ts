import { catalogAccess } from '@/lib/catalog/access';
import { flushObjectDeletion, removeStory } from '@/lib/catalog/object-deletions';
import { parseManualMetadata, saveManualMetadata } from '@/lib/catalog/manual-metadata';
export const dynamic = 'force-dynamic';
const error = (message: string, status: number) => Response.json({ error: message }, { status });
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role === 'user') return error('Forbidden.', 403);
 let body: { folderId?: unknown; metadata?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.', 400); }
 const { id } = await params, db = access.context.db;
 if (body.metadata !== undefined) {
  if (access.context.role !== 'admin') return error('Forbidden.', 403);
  const edits = parseManualMetadata(body.metadata);
  if (!edits) return error('Invalid metadata.', 400);
  return await saveManualMetadata(db, id, edits) ? Response.json({ ok: true }) : error('Story not found.', 404);
 }
 if (body.folderId !== null && typeof body.folderId !== 'string') return error('Invalid folder.', 400);
 if (body.folderId && !await db.prepare('SELECT id FROM shared_folders WHERE id = ?').bind(body.folderId).first()) return error('Folder not found.', 404);
 const result = await db.prepare('UPDATE shared_stories SET folder_id = ? WHERE id = ?').bind(body.folderId, id).run();
 if (!result.meta.changes) return error('Story not found.', 404);
 return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 const { id } = await params;
 const key = await removeStory(access.context.db, id);
 if (!key) return error('Story not found.', 404);
 await flushObjectDeletion(access.context.db, access.context.bucket, key);
 return Response.json({ ok: true });
}

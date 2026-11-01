import { catalogAccess } from '@/lib/catalog/access';
import { deleteEmptyFolder } from '@/lib/catalog/folder-delete';

export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });

export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const result = await access.context.db.prepare('SELECT id, parent_id AS parentId, name, created_at AS createdAt FROM shared_folders ORDER BY name COLLATE NOCASE').all();
 return Response.json({ folders: result.results });
}

export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 let body: { name?: unknown; parentId?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 const name = typeof body.name === 'string' ? body.name.trim() : '';
 const parent = body.parentId === null || body.parentId === undefined ? null : body.parentId;
 if (!name || name.length > 180 || /[\x00-\x1f/\\]/.test(name) || (parent !== null && typeof parent !== 'string')) return error('Invalid folder.');
 const db = access.context.db;
 if (parent && !await db.prepare('SELECT id FROM shared_folders WHERE id = ?').bind(parent).first()) return error('Folder not found.', 404);
 const existing = await db.prepare('SELECT id FROM shared_folders WHERE parent_id IS ? AND name = ? COLLATE NOCASE').bind(parent, name).first<{ id: string }>();
 if (existing) return Response.json({ id: existing.id, existing: true });
 const id = crypto.randomUUID();
 try {
  const inserted = await db.prepare('INSERT INTO shared_folders (id, parent_id, name, created_at) SELECT ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM shared_folders WHERE id = ?) RETURNING id').bind(id, parent, name, Date.now(), parent, parent).first();
  if (!inserted) return error('Parent folder no longer exists.', 409);
 }
 catch (cause) {
  const concurrent = await db.prepare('SELECT id FROM shared_folders WHERE parent_id IS ? AND name = ? COLLATE NOCASE').bind(parent, name).first<{ id: string }>();
  if (concurrent) return Response.json({ id: concurrent.id, existing: true });
  throw cause;
 }
 return Response.json({ id, existing: false }, { status: 201 });
}

export async function DELETE(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 let body: { id?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 if (typeof body.id !== 'string') return error('Invalid folder.');
 if (!await deleteEmptyFolder(access.context.db, body.id)) return error("The folder should be empty and not have ongoing imports.", 409);
 return Response.json({ ok: true });
}

export async function PATCH(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 let body: { id?: unknown; name?: unknown; parentId?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 const name = typeof body.name === 'string' ? body.name.trim() : '';
 if (typeof body.id !== 'string' || !name || name.length > 180 || /[\x00-\x1f/\\]/.test(name) || (body.parentId !== null && typeof body.parentId !== 'string')) return error('Invalid folder.');
 const db = access.context.db;
 const folders = await db.prepare('SELECT id, parent_id AS parentId FROM shared_folders').all<{ id: string; parentId: string | null }>();
 const parents = new Map(folders.results.map(folder => [folder.id, folder.parentId]));
 if (!parents.has(body.id) || (body.parentId && !parents.has(body.parentId))) return error('Folder not found.', 404);
 let cursor = body.parentId as string | null; const seen = new Set<string>();
 while (cursor) {
  if (cursor === body.id || seen.has(cursor)) return error('Folders cannot contain themselves.', 409);
  seen.add(cursor); cursor = parents.get(cursor) || null;
 }
 const duplicate = await db.prepare('SELECT id FROM shared_folders WHERE parent_id IS ? AND name = ? COLLATE NOCASE AND id <> ?').bind(body.parentId, name, body.id).first();
 if (duplicate) return error('A folder with that name already exists here.', 409);
 try {
  const updated = await db.prepare(`WITH RECURSIVE ancestors(id, parent_id) AS (SELECT id, parent_id FROM shared_folders WHERE id = ? UNION SELECT f.id, f.parent_id FROM shared_folders f JOIN ancestors a ON f.id = a.parent_id) UPDATE shared_folders SET name = ?, parent_id = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM ancestors WHERE id = ?) AND (? IS NULL OR EXISTS (SELECT 1 FROM shared_folders WHERE id = ?)) RETURNING id`).bind(body.parentId, name, body.parentId, body.id, body.id, body.parentId, body.parentId).first();
  if (!updated) return error('Folder changed or would create a cycle.', 409);
 }
 catch (cause) {
  const conflict = await db.prepare('SELECT id FROM shared_folders WHERE parent_id IS ? AND name = ? COLLATE NOCASE AND id <> ?').bind(body.parentId, name, body.id).first();
  if (conflict) return error('A folder with that name already exists here.', 409);
  throw cause;
 }
 return Response.json({ ok: true });
}

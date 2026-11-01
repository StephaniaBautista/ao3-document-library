import { catalogAccess } from '@/lib/catalog/access';
import { env } from 'cloudflare:workers';
import { getAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
function sameOrigin(req: Request) { const origin = req.headers.get('origin'); return !!origin && origin === new URL(req.url).origin; }
async function context(req: Request, write = false) {
 const access = await catalogAccess(req, write);
 if (access.error) return null;
 const user = (await getAuth().api.getSession({ headers: req.headers }))?.user;
 if (!user?.emailVerified) return null;
 if (write && !sameOrigin(req)) return null;
 if (!env.DB || !env.BUCKET) throw new Error('Storage unavailable');
 return { user, db: env.DB, bucket: env.BUCKET };
}
async function ownsFolder(db: D1Database, owner: string, id: string | null) {
 if (!id) return true;
 return !!await db.prepare('SELECT id FROM folders WHERE owner = ? AND id = ?').bind(owner,id).first();
}
export async function GET(req: Request) {
 const c = await context(req); if (!c) return error('Sign in to continue.',401);
 const url = new URL(req.url); const folder = url.searchParams.get('folder') || null;
 if (!await ownsFolder(c.db,c.user.id,folder)) return error('Folder not found.',404);
 const search = (url.searchParams.get('q') || '').slice(0,120).trim();
 const offset = Math.max(0, Math.min(1000000, Number(url.searchParams.get('offset')) || 0));
 const folderResult = await c.db.prepare('SELECT id, parent_id as parentId, name, created_at as createdAt FROM folders WHERE owner = ? ORDER BY name COLLATE NOCASE LIMIT 5000').bind(c.user.id).all();
 const list = search
  ? await c.db.prepare("SELECT id, folder_id as folderId, name, type, size, created_at as createdAt FROM files WHERE owner = ? AND name LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 101 OFFSET ?").bind(c.user.id,`%${search.replace(/[\\%_]/g,'\\$&')}%`,offset).all()
  : await c.db.prepare('SELECT id, folder_id as folderId, name, type, size, created_at as createdAt FROM files WHERE owner = ? AND folder_id IS ? ORDER BY created_at DESC LIMIT 101 OFFSET ?').bind(c.user.id,folder,offset).all();
 return Response.json({ folders: folderResult.results, files: list.results.slice(0,100), hasMore: list.results.length > 100 });
}
export async function POST(req: Request) {
 const c = await context(req,true); if (!c) return error('Unauthorized.',401);
 const kind = req.headers.get('content-type') || '';
 if (kind.startsWith('application/json')) {
  const body = await req.json() as {name?:unknown; parentId?:unknown};
  const name = typeof body.name === 'string' ? body.name.trim().slice(0,180) : '';
  const parent = typeof body.parentId === 'string' && body.parentId ? body.parentId : null;
  if (!name || /[\x00-\x1f]/.test(name)) return error('Enter a valid folder name.');
  if (!await ownsFolder(c.db,c.user.id,parent)) return error('Folder not found.',404);
  const id = crypto.randomUUID();
  await c.db.prepare('INSERT INTO folders (id, owner, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?)').bind(id,c.user.id,parent,name,Date.now()).run();
  return Response.json({id}, {status:201});
 }
 if (!kind.startsWith('multipart/form-data')) return error('Unsupported request format.');
 const length = Number(req.headers.get('content-length') || 0); if (length > 52 * 1024 * 1024) return error('The file exceeds the 50 MB limit.',413);
 const data = await req.formData(); const file = data.get('file'); const rawFolder = data.get('folderId');
 const folder = typeof rawFolder === 'string' && rawFolder ? rawFolder : null;
 if (!(file instanceof File) || !file.size || file.size > 50*1024*1024) return error('Files must be between 1 byte and 50 MB.',413);
 if (!await ownsFolder(c.db,c.user.id,folder)) return error('Folder not found.',404);
 const name = file.name.replace(/[\x00-\x1f/\\]/g,'_').slice(0,180); const extension = name.split('.').pop()?.toLowerCase();
 const head = new Uint8Array(await file.slice(0,5).arrayBuffer());
 const validPdf = extension === 'pdf' && String.fromCharCode(...head) === '%PDF-';
 const validEpub = extension === 'epub' && head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;
 if (!validPdf && !validEpub) return error('Only valid PDF and EPUB files are supported.');
 const id = crypto.randomUUID(), key = `${c.user.id}/${id}`;
 await c.bucket.put(key,file.stream(),{httpMetadata:{contentType: validPdf ? 'application/pdf' : 'application/epub+zip'}});
 try { await c.db.prepare('INSERT INTO files (id, owner, folder_id, name, type, size, object_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id,c.user.id,folder,name,extension,file.size,key,Date.now()).run(); }
 catch (e) { await c.bucket.delete(key); throw e; }
 return Response.json({id}, {status:201});
}
export async function DELETE(req: Request) {
 const c = await context(req,true); if (!c) return error('Unauthorized.',401);
 const {id, kind} = await req.json() as {id?:string; kind?:string};
 if (!id || !['file','folder'].includes(kind || '')) return error('Invalid request.');
 if (kind === 'folder') {
  const child = await c.db.prepare('SELECT id FROM folders WHERE owner = ? AND parent_id = ? UNION ALL SELECT id FROM files WHERE owner = ? AND folder_id = ? LIMIT 1').bind(c.user.id,id,c.user.id,id).first();
  if (child) return error('The folder must be empty before it can be deleted.',409);
  await c.db.prepare('DELETE FROM folders WHERE owner = ? AND id = ?').bind(c.user.id,id).run();
 } else {
  const file = await c.db.prepare('SELECT object_key as objectKey FROM files WHERE owner = ? AND id = ?').bind(c.user.id,id).first<{objectKey:string}>();
  if (!file) return error('File not found.',404);
  await c.bucket.delete(file.objectKey);
  await c.db.prepare('DELETE FROM files WHERE owner = ? AND id = ?').bind(c.user.id,id).run();
 }
 return Response.json({ok:true});
}

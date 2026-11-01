import { catalogAccess } from '@/lib/catalog/access';
export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const rows = await access.context.db.prepare('SELECT id, name, created_at AS createdAt FROM favorite_collections WHERE user_id = ? ORDER BY name COLLATE NOCASE').bind(access.context.userId).all();
 return Response.json({ collections: rows.results });
}
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 let body: { name?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 const name = typeof body.name === 'string' ? body.name.trim() : '';
 if (!name || name.length > 180 || /[\x00-\x1f]/.test(name)) return error('Invalid name.');
 const id = crypto.randomUUID();
 await access.context.db.prepare('INSERT INTO favorite_collections (id, user_id, name, created_at) VALUES (?, ?, ?, ?)').bind(id, access.context.userId, name, Date.now()).run();
 return Response.json({ id, name }, { status: 201 });
}

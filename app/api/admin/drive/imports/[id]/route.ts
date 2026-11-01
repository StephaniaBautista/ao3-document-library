import { env } from 'cloudflare:workers';
import { processDriveImports } from '@/lib/catalog/drive-import';
import { refreshDriveAccessToken } from '@/lib/catalog/drive';
import { catalogAccess } from '@/lib/catalog/access';
import { listDriveFailures, parseFailureCursor } from '@/lib/catalog/drive-failures';
import { listDriveDuplicates } from '@/lib/catalog/drive-duplicates';
export const dynamic = 'force-dynamic';
const error = (message: string, status: number) => Response.json({ error: message }, { status });
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 const { id } = await params, db = access.context.db;
 const job = await db.prepare('SELECT id, state, created_at AS createdAt FROM drive_import_jobs WHERE id = ? AND user_id = ?').bind(id, access.context.userId).first();
 if (!job) return error('Import not found.', 404);
 const url = new URL(req.url), cursor = parseFailureCursor(url.searchParams.get('afterId')), duplicateCursor = parseFailureCursor(url.searchParams.get('afterDuplicateId'));
 if (cursor === false || duplicateCursor === false) return error('Invalid page cursor.', 400);
 const counts = await db.prepare('SELECT state, count(*) AS count FROM drive_import_items WHERE job_id = ? GROUP BY state').bind(id).all();
 const { failures, nextFailureCursor } = await listDriveFailures(db, id, cursor);
 const { duplicates, nextDuplicateCursor } = await listDriveDuplicates(db, id, duplicateCursor);
 return Response.json({ job, counts: counts.results, failures, nextFailureCursor, duplicates, nextDuplicateCursor }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 const { id } = await params, db = access.context.db;
 if (!await db.prepare('SELECT id FROM drive_import_jobs WHERE id = ? AND user_id = ?').bind(id, access.context.userId).first()) return error('Import not found.', 404);
 await db.batch([db.prepare("UPDATE drive_import_items SET state = 'pending', error = NULL, updated_at = ? WHERE job_id = ? AND state = 'failed'").bind(Date.now(), id), db.prepare("UPDATE drive_import_jobs SET state = 'pending' WHERE id = ?").bind(id)]);
 return Response.json({ ok: true });
}

// Each explicit request advances only the selected job; old queues are never resumed automatically.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 const { id } = await params;
 if (!await access.context.db.prepare('SELECT id FROM drive_import_jobs WHERE id = ? AND user_id = ?').bind(id, access.context.userId).first()) return error('Import not found.', 404);
 await processDriveImports(env, refreshDriveAccessToken, 1, id);
 return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

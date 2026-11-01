import { catalogAccess } from '@/lib/catalog/access';
import { processObjectDeletions } from '@/lib/catalog/object-deletions';

export const dynamic = 'force-dynamic';
async function pending(db: D1Database) {
 return db.prepare('SELECT count(*) AS count, min(queued_at) AS oldest FROM object_deletions WHERE deleted_at IS NULL').first<{ count: number; oldest: number | null }>();
}
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return Response.json({ error: 'Forbidden.' }, { status: 403 });
 return Response.json(await pending(access.context.db), { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return Response.json({ error: 'Forbidden.' }, { status: 403 });
 await processObjectDeletions({ DB: access.context.db, BUCKET: access.context.bucket });
 return Response.json(await pending(access.context.db), { headers: { 'Cache-Control': 'no-store' } });
}

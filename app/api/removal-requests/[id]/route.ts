import { catalogAccess } from '@/lib/catalog/access';
import { approveRemoval, flushObjectDeletion } from '@/lib/catalog/object-deletions';
export const dynamic = 'force-dynamic';
const error = (message: string, status: number) => Response.json({ error: message }, { status });
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 let body: { decision?: unknown; storyId?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.', 400); }
 if (!body || typeof body !== 'object' || Array.isArray(body) || (body.decision !== 'approve' && body.decision !== 'reject')) return error('Invalid decision.', 400);
 const { id } = await params, db = access.context.db;
 if (body.decision === 'approve') {
  if (typeof body.storyId !== 'string' || !body.storyId || body.storyId.length > 128) return error('Select the story being reviewed.', 400);
  const key = await approveRemoval(db, id, body.storyId);
  if (!key) return error('Request or story changed.', 409);
  await flushObjectDeletion(db, access.context.bucket, key);
 } else {
  const result = await db.prepare("DELETE FROM removal_requests WHERE id = ? AND status = 'pending'").bind(id).run();
  if (!result.meta.changes) return error('Request not found.', 404);
 }
 return Response.json({ ok: true });
}

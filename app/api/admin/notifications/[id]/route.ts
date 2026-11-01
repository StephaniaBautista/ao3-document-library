import { catalogAccess } from '@/lib/catalog/access';
export const dynamic = 'force-dynamic';
const error = (message: string, status: number) => Response.json({ error: message }, { status });
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 let body: { decision?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.', 400); }
 if (body.decision !== 'retry' && body.decision !== 'confirm_sent') return error('Invalid decision.', 400);
 const { id } = await params, db = access.context.db;
 const row = await db.prepare('SELECT state FROM notification_batches WHERE id = ?').bind(id).first<{ state: string }>();
 if (!row || !['failed', 'unknown'].includes(row.state)) return error('Notification cannot be resolved.', 409);
 if (body.decision === 'confirm_sent') {
  if (row.state !== 'unknown') return error('Only an uncertain notification can be confirmed sent.', 409);
  await db.batch([db.prepare('DELETE FROM reminders WHERE id IN (SELECT reminder_id FROM notification_items WHERE batch_id = ?)').bind(id), db.prepare("UPDATE notification_batches SET state = 'sent' WHERE id = ? AND state = 'unknown'").bind(id)]);
 } else {
  await db.prepare("UPDATE notification_batches SET state = 'pending' WHERE id = ? AND state IN ('failed', 'unknown')").bind(id).run();
 }
 return Response.json({ ok: true });
}

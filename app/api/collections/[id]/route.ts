import { catalogAccess } from '@/lib/catalog/access';
export const dynamic = 'force-dynamic';
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const { id } = await params;
 const result = await access.context.db.prepare('DELETE FROM favorite_collections WHERE id = ? AND user_id = ?').bind(id, access.context.userId).run();
 return result.meta.changes ? Response.json({ ok: true }) : Response.json({ error: 'Collection not found.' }, { status: 404 });
}

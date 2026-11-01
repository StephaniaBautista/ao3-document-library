import { catalogAccess } from '@/lib/catalog/access';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 if (access.context.role === 'user') return new Response('Forbidden', { status: 403 });
 const { id, imageId } = await params;
 const row = await access.context.db.prepare("SELECT i.content_type AS contentType, i.data FROM removal_evidence_images i JOIN removal_requests r ON r.id = i.request_id WHERE i.id = ? AND r.id = ? AND r.status = 'pending'").bind(imageId, id).first<{ contentType: string; data: number[] }>();
 if (!row) return new Response('Not found', { status: 404 });
 return new Response(new Uint8Array(row.data), { headers: { 'Content-Type': row.contentType, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}

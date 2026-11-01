import { catalogAccess } from '@/lib/catalog/access';

export const dynamic = 'force-dynamic';

// Originals are not sent to readers. The protected reader requests extracted text
// through the reading endpoint; the extractor uses its own signed internal route.
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 return Response.json({ error: "File downloads are unavailable." }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
}

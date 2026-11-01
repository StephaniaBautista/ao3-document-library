import { catalogAccess } from '@/lib/catalog/access';
import { createConnection } from '@/lib/catalog/drive-connect';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return Response.json({ error: 'Forbidden.' }, { status: 403 });
 return createConnection(access.context.userId);
}

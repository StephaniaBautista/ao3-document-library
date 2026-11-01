import { catalogAccess } from '@/lib/catalog/access';
import { listNotificationIssues } from '@/lib/catalog/notification-query';
import { parseUserCursor } from '@/lib/catalog/users-query';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return Response.json({ error: 'Forbidden.' }, { status: 403 });
 const url = new URL(req.url), cursor = parseUserCursor(url.searchParams.get('afterTime'), url.searchParams.get('afterId'));
 if (cursor === false) return Response.json({ error: 'Invalid page cursor.' }, { status: 400 });
 return Response.json(await listNotificationIssues(access.context.db, cursor), { headers: { 'Cache-Control': 'no-store' } });
}

import { catalogAccess } from '@/lib/catalog/access';
import { listReadingPositions, parseReadingFilters, readingFilterOptions } from '@/lib/catalog/reading-query';
import { parseUserCursor } from '@/lib/catalog/users-query';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const url = new URL(req.url), cursor = parseUserCursor(url.searchParams.get('afterTime'), url.searchParams.get('afterId'));
 if (cursor === false) return Response.json({ error: 'Invalid page cursor.' }, { status: 400 });
 const filters = parseReadingFilters(url.searchParams);
 if (!filters) return Response.json({ error: 'Invalid filters.' }, { status: 400 });
 const [result, options] = await Promise.all([listReadingPositions(access.context.db, access.context.userId, cursor, 50, filters), cursor ? null : readingFilterOptions(access.context.db, access.context.userId)]);
 return Response.json({ ...result, options }, { headers: { 'Cache-Control': 'no-store' } });
}

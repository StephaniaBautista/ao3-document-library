import { catalogAccess } from '@/lib/catalog/access';
import { getTranslationWindow } from '@/lib/catalog/translation-window';

export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const value = new URL(req.url).searchParams.get('position');
 if (value !== null && (!/^\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value)))) return Response.json({ error: 'Invalid position.' }, { status: 400 });
 const { id } = await params;
 const window = await getTranslationWindow(access.context.db, access.context.userId, id, value === null ? null : Number(value));
 if (!window) return Response.json({ error: 'Translation not found.' }, { status: 404 });
 return Response.json(window, { headers: { 'Cache-Control': 'no-store' } });
}

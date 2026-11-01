import { catalogAccess } from '@/lib/catalog/access';
import { saveTranslationPosition } from '@/lib/catalog/translation-position';

export const dynamic = 'force-dynamic';
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 let body: { position?: unknown };
 try { body = await req.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
 if (!body || typeof body.position !== 'number' || !Number.isSafeInteger(body.position) || body.position < 0) return Response.json({ error: 'Invalid position.' }, { status: 400 });
 const { id } = await params;
 if (!await saveTranslationPosition(access.context.db, access.context.userId, id, body.position)) return Response.json({ error: 'Translation or position not found.' }, { status: 404 });
 return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

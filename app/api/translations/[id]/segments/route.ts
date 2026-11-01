import { env } from 'cloudflare:workers';
import { catalogAccess } from '@/lib/catalog/access';
import { processTranslationSegments } from '@/lib/catalog/translation';
import { claimBrowserExtraction, finishBrowserExtraction, saveBrowserSegments } from '@/lib/catalog/browser-extraction';
export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const { id } = await params, db = access.context.db;
 let body: { segments?: unknown; claim?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 if (!body || typeof body.claim !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.claim) || !Array.isArray(body.segments) || !body.segments.length || body.segments.length > 50 || body.segments.some((s: unknown) => !s || typeof s !== 'object' || typeof (s as { text?: unknown }).text !== 'string' || !(s as { text: string }).text.trim() || (s as { text: string }).text.length > 5000 || !Number.isSafeInteger((s as { position?: unknown }).position) || Number((s as { position: number }).position) < 0)) return error('Invalid segments.');
 if (!await saveBrowserSegments(db, access.context.userId, id, body.claim, body.segments)) return error("Preparation is no longer active. Please try again.", 409);
 await processTranslationSegments(env, id, 1);
 return Response.json({ ok: true });
}
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const { id } = await params, db = access.context.db;
 const job = await db.prepare('SELECT extraction_state AS extractionState, reading_position AS readingPosition FROM translation_jobs WHERE id = ? AND user_id = ?').bind(id, access.context.userId).first<{ extractionState: string; readingPosition: number }>();
 if (!job) return error('Translation not found.', 404);
 const rows = await db.prepare('SELECT position, translated_text AS translatedText, state FROM translation_segments WHERE job_id = ? ORDER BY position').bind(id).all();
 return Response.json({ segments: rows.results, extractionState: job.extractionState, readingPosition: job.readingPosition }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const { id } = await params, db = access.context.db;
 if (!await db.prepare('SELECT id FROM translation_jobs WHERE id = ? AND user_id = ?').bind(id, access.context.userId).first()) return error('Translation not found.', 404);
 let body: { complete?: unknown; browser?: unknown; failed?: unknown; claim?: unknown } = {};
 try { body = await req.json() || {}; } catch { /* No body means retry. */ }
 if (body.browser === true) {
  const claim = await claimBrowserExtraction(db, access.context.userId, id);
  if (!claim) return error("Preparation is already underway or finished.", 409);
  return Response.json({ claim });
 }
 if (body.complete === true) {
  if (typeof body.claim !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.claim)) return error('Invalid preparation.');
  if (!await finishBrowserExtraction(db, access.context.userId, id, body.claim)) return error("The preparation stopped being active.", 409);
  return Response.json({ ok: true });
 }
 if (body.failed === true) {
  if (typeof body.claim !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.claim)) return error('Invalid preparation.');
  if (!await finishBrowserExtraction(db, access.context.userId, id, body.claim, true)) return error("The preparation stopped being active.", 409);
  return Response.json({ ok: true });
 }
 await db.prepare("UPDATE translation_segments SET state = 'pending', updated_at = ? WHERE job_id = ? AND state = 'failed'").bind(Date.now(), id).run();
 await db.prepare("UPDATE translation_jobs SET extraction_state = 'pending', extraction_claimed_at = NULL WHERE id = ? AND extraction_state = 'failed'").bind(id).run();
 await processTranslationSegments(env, id, 1);
 return Response.json({ ok: true });
}

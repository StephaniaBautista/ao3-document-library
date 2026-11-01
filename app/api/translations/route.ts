import { env } from 'cloudflare:workers';
import { catalogAccess } from '@/lib/catalog/access';
export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (!env.GOOGLE_TRANSLATE_API_KEY) return error('Translation is not configured yet.', 503);
 let body: { storyId?: unknown; target?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 if (typeof body.storyId !== 'string' || typeof body.target !== 'string' || !/^(?=.{2,35}$)[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(body.target)) return error('Invalid translation request.');
 if (!await access.context.db.prepare('SELECT id FROM shared_stories WHERE id = ?').bind(body.storyId).first()) return error('Story not found.', 404);
 const id = crypto.randomUUID();
 await access.context.db.prepare('INSERT OR IGNORE INTO translation_jobs (id, user_id, story_id, target_language, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, access.context.userId, body.storyId, body.target, Date.now()).run();
 const job = await access.context.db.prepare('SELECT id, extraction_state AS extractionState FROM translation_jobs WHERE user_id = ? AND story_id = ? AND target_language = ?').bind(access.context.userId, body.storyId, body.target).first<{ id: string; extractionState: string }>();
 return Response.json({ id: job?.id, extractionState: job?.extractionState, serverExtraction: !!(env.EXTRACTOR_URL && env.EXTRACTOR_TOKEN) }, { status: 201 });
}

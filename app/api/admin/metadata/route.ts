import { catalogAccess } from '@/lib/catalog/access';
import { saveMetadata } from '@/lib/catalog/metadata-store';
import { env } from 'cloudflare:workers';
export const dynamic = 'force-dynamic';
const error = (message: string, status: number) => Response.json({ error: message }, { status });
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 const rows = await access.context.db.prepare("SELECT id, filename, file_type AS fileType, size FROM shared_stories WHERE metadata_status = 'pending' AND (file_type = 'pdf' OR size <= 25165824) ORDER BY created_at LIMIT 10").all();
 return Response.json({ stories: rows.results, serverExtraction: !!(env.EXTRACTOR_URL && env.EXTRACTOR_TOKEN) });
}
export async function PATCH(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 let body: { id?: unknown; metadata?: unknown; failed?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.', 400); }
 if (typeof body.id !== 'string') return error('Invalid story.', 400);
 if (body.failed === true) {
  await access.context.db.prepare("UPDATE shared_stories SET metadata_status = 'failed' WHERE id = ? AND metadata_status = 'pending'").bind(body.id).run();
  return Response.json({ ok: true });
 }
 if (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata)) return error('Invalid metadata.', 400);
 const result = await saveMetadata(access.context.db, access.context.bucket, body.id, body.metadata as Record<string, unknown>, 'pending');
 return result.ok ? Response.json(result) : error('Story not found or already processed.', 404);
}

export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 const result = await access.context.db.prepare("UPDATE shared_stories SET metadata_status = 'pending', metadata_claimed_at = NULL WHERE metadata_status = 'failed'").run();
 return Response.json({ queued: result.meta.changes });
}

import { env } from 'cloudflare:workers';
import { sendRemovalNotification } from '@/lib/catalog/removal-notifications';
import { catalogAccess } from '@/lib/catalog/access';
import { listRemovalRequests } from '@/lib/catalog/removal-query';
import { parseUserCursor } from '@/lib/catalog/users-query';
import { evidenceImageType, MAX_EVIDENCE_IMAGES, MAX_EVIDENCE_IMAGE_BYTES, parseEvidenceLinks, readEvidenceBody } from '@/lib/catalog/removal-evidence';
export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });

export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const bytes = await readEvidenceBody(req);
 if (!bytes) return error("The request is too big.", 413);
 let body: { storyId?: unknown; storyDescription?: unknown; proof?: unknown; links?: unknown }, images: File[] = [];
 try {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.startsWith('multipart/form-data;')) {
   const data = await new Response(new Uint8Array(bytes).buffer, { headers: { 'content-type': contentType } }).formData();
   body = { storyId: data.get('storyId'), storyDescription: data.get('storyDescription'), proof: data.get('proof'), links: data.getAll('links') };
   const files = data.getAll('images');
   if (files.some(file => typeof file === 'string')) return error("Non-valid images.");
   images = files as File[];
  } else if (contentType.startsWith('application/json')) body = JSON.parse(new TextDecoder().decode(bytes));
  else return error("Non-valid application format.");
 } catch { return error("Request not valid."); }
 if (!body || typeof body !== 'object' || Array.isArray(body)) return error("Request not valid.");
 const storyId = typeof body.storyId === 'string' && body.storyId ? body.storyId : null;
 const storyDescription = typeof body.storyDescription === 'string' ? body.storyDescription.trim() : '';
 const proof = typeof body.proof === 'string' ? body.proof.trim() : '';
 const links = parseEvidenceLinks(body.links ?? []);
 if (!storyDescription || storyDescription.length > 1000 || proof.length > 10000 || !links || images.length > MAX_EVIDENCE_IMAGES || (!proof && !links.length && !images.length)) return error("Add an explanation, links, or images as evidence.");
 const attachments: { id: string; type: string; data: Uint8Array }[] = [];
 for (const image of images) {
  if (!image.size || image.size > MAX_EVIDENCE_IMAGE_BYTES) return error("Each image should weigh up to 1.5 MB.");
  const data = new Uint8Array(await image.arrayBuffer()), type = evidenceImageType(data);
  if (!type || type !== image.type) return error("Only valid PNG, JPEG or WebP images are allowed.");
  attachments.push({ id: crypto.randomUUID(), type, data });
 }
 if (storyId && !await access.context.db.prepare('SELECT id FROM shared_stories WHERE id = ?').bind(storyId).first()) return error("Story not found.", 404);
 const id = crypto.randomUUID(), db = access.context.db;
 await db.batch([
  db.prepare("INSERT INTO removal_requests (id, requester_id, story_id, story_description, proof, links, email_status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)").bind(id, access.context.userId, storyId, storyDescription, proof, JSON.stringify(links), Date.now()),
  ...attachments.map(image => db.prepare('INSERT INTO removal_evidence_images (id, request_id, content_type, data) VALUES (?, ?, ?, ?)').bind(image.id, id, image.type, image.data.buffer)),
 ]);
 const emailStatus = await sendRemovalNotification(env, id);
 return Response.json({ id, emailStatus }, { status: 201 });
}

export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 if (access.context.role === 'user') return error('Forbidden.', 403);
 const url = new URL(req.url), cursor = parseUserCursor(url.searchParams.get('afterTime'), url.searchParams.get('afterId'));
 if (cursor === false) return error('Invalid page cursor.');
 return Response.json(await listRemovalRequests(access.context.db, cursor), { headers: { 'Cache-Control': 'no-store' } });
}

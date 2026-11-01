import { env } from 'cloudflare:workers';
import { catalogAccess } from '@/lib/catalog/access';
import { hashObject, verifyUploadTicket } from '@/lib/catalog/multipart';

export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const ticket = await verifyUploadTicket(req.headers.get('x-upload-token'), env.BETTER_AUTH_SECRET || '', access.context.userId);
 if (!ticket) return error("Invalid upload.");
 const db = access.context.db, bucket = access.context.bucket, key = `catalog/${ticket.id}`;
 if (await db.prepare('SELECT object_key FROM object_deletions WHERE object_key = ?').bind(key).first()) return error("This upload is no longer available.", 409);
 const published = await db.prepare('SELECT id FROM shared_stories WHERE id = ? AND object_key = ?').bind(ticket.id, key).first<{ id: string }>();
 if (published) return Response.json({ id: published.id, duplicate: false });
 let body: { parts?: unknown };
 try { body = await req.json(); } catch { return error("Invalid request."); }
 const count = Math.ceil(ticket.size / ticket.partSize);
 if (!Array.isArray(body?.parts) || body.parts.length !== count || body.parts.some((part: unknown, index: number) => !part || typeof part !== 'object' || !('partNumber' in part) || part.partNumber !== index + 1 || !('etag' in part) || typeof part.etag !== 'string' || part.etag.length < 1 || part.etag.length > 256)) return error("Invalid upload parts.");
 try {
  let stored = await bucket.head(key);
  if (!stored) {
   try { stored = await bucket.resumeMultipartUpload(key, ticket.uploadId).complete(body.parts as R2UploadedPart[]); }
   catch { stored = await bucket.head(key); if (!stored) throw new Error('Upload incomplete'); }
  }
  if (stored.size !== ticket.size) throw new Error('Unexpected object size');
  const prefix = await bucket.get(key, { range: { offset: 0, length: Math.min(5, ticket.size) } });
  if (!prefix) throw new Error('Missing object');
  const head = new Uint8Array(await prefix.arrayBuffer());
  const valid = ticket.fileType === 'pdf' ? String.fromCharCode(...head) === '%PDF-' : head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;
  if (!valid) { await bucket.delete(key); return error("Only PDF and EPUB files are supported."); }
  const object = await bucket.get(key);
  if (!object) throw new Error('Missing object');
  const hash = await hashObject(object.body, ticket.size);
  try {
   const inserted = await db.prepare('INSERT INTO shared_stories (id, folder_id, submitted_by, filename, file_type, size, object_key, content_hash, title, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ? > ? AND NOT EXISTS (SELECT 1 FROM object_deletions WHERE object_key = ?)')
    .bind(ticket.id, ticket.folderId, ticket.userId, ticket.filename, ticket.fileType, ticket.size, key, hash, ticket.filename.replace(/\.(pdf|epub)$/i, ''), Date.now(), ticket.expiresAt, Date.now(), key).run();
   if (!inserted.meta.changes) return error("This upload is no longer available.", 409);
  } catch (cause) {
   const sameUpload = await db.prepare('SELECT id FROM shared_stories WHERE id = ? AND object_key = ?').bind(ticket.id, key).first<{ id: string }>();
   if (sameUpload) return Response.json({ id: sameUpload.id, duplicate: false });
   const duplicate = await db.prepare('SELECT id FROM shared_stories WHERE content_hash = ?').bind(hash).first<{ id: string }>();
   if (duplicate) { await bucket.delete(key); return Response.json({ id: duplicate.id, duplicate: true }); }
   throw cause;
  }
  return Response.json({ id: ticket.id, duplicate: false }, { status: 201 });
 } catch { return error("Could not complete the upload. Please try again.", 503); }
}

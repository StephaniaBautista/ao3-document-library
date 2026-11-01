import { env } from 'cloudflare:workers';
import { catalogAccess } from '@/lib/catalog/access';
import { choosePartSize, partLength, signUploadTicket, verifyUploadTicket, type UploadTicket } from '@/lib/catalog/multipart';

export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) return error("Upload is unavailable.", 503);
 let body: { filename?: unknown; size?: unknown; folderId?: unknown };
 try { body = await req.json(); } catch { return error("Invalid request."); }
 const filename = typeof body?.filename === 'string' ? body.filename.replace(/[\x00-\x1f/\\]/g, '_').trim().slice(0, 180) : '';
 const extension = filename.split('.').pop()?.toLowerCase();
 const size = typeof body?.size === 'number' ? body.size : 0, partSize = choosePartSize(size);
 const folderId = body?.folderId === null || body?.folderId === undefined ? null : body.folderId;
 if (!filename || (extension !== 'pdf' && extension !== 'epub') || !partSize || (folderId !== null && typeof folderId !== 'string')) return error("Invalid file or folder.");
 if (folderId && !await access.context.db.prepare('SELECT id FROM shared_folders WHERE id = ?').bind(folderId).first()) return error("The folder doesn't exist.", 404);
 const id = crypto.randomUUID(), key = `catalog/${id}`;
 const upload = await access.context.bucket.createMultipartUpload(key, { httpMetadata: { contentType: extension === 'pdf' ? 'application/pdf' : 'application/epub+zip' } });
 try {
  const ticket: UploadTicket = { version: 1, id, userId: access.context.userId, uploadId: upload.uploadId, filename, fileType: extension, folderId, size, partSize, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  return Response.json({ token: await signUploadTicket(ticket, env.BETTER_AUTH_SECRET), partSize }, { status: 201 });
 } catch (cause) { await upload.abort(); throw cause; }
}

export async function PUT(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const ticket = await verifyUploadTicket(req.headers.get('x-upload-token'), env.BETTER_AUTH_SECRET || '', access.context.userId);
 const rawNumber = req.headers.get('x-part-number') || '';
 const number = /^\d{1,5}$/.test(rawNumber) ? Number(rawNumber) : 0;
 const length = ticket ? partLength(ticket, number) : null;
 if (!ticket || !length || !req.body) return error("Invalid upload part.");
 const contentLength = req.headers.get('content-length');
 if (contentLength && Number(contentLength) !== length) return error("Incorrect part size.");
 try {
  const fixed = new FixedLengthStream(length);
  const upload = access.context.bucket.resumeMultipartUpload(`catalog/${ticket.id}`, ticket.uploadId);
  const [part] = await Promise.all([upload.uploadPart(number, fixed.readable), req.body.pipeTo(fixed.writable)]);
  return Response.json(part);
 } catch { return error("Could not save the part. Please try again.", 503); }
}

export async function DELETE(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const ticket = await verifyUploadTicket(req.headers.get('x-upload-token'), env.BETTER_AUTH_SECRET || '', access.context.userId);
 if (!ticket) return error("Invalid upload.");
 try { await access.context.bucket.resumeMultipartUpload(`catalog/${ticket.id}`, ticket.uploadId).abort(); }
 catch { /* Already completed or aborted; published objects are never deleted here. */ }
 return Response.json({ ok: true });
}

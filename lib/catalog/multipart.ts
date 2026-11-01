import { createHash } from 'node:crypto';

const MiB = 1024 * 1024;
const maxParts = 10000;
const maxPartSize = 64 * MiB;
export type UploadTicket = { version: 1; id: string; userId: string; uploadId: string; filename: string; fileType: 'pdf' | 'epub'; folderId: string | null; size: number; partSize: number; expiresAt: number };
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decode(value: string) { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), c => c.charCodeAt(0)); }
async function hmacKey(secret: string) {
 return crypto.subtle.importKey('raw', encoder.encode(`catalog-upload-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export function choosePartSize(size: number) {
 if (!Number.isSafeInteger(size) || size < 1) return null;
 const partSize = Math.max(8 * MiB, Math.ceil(size / maxParts / MiB) * MiB);
 return partSize <= maxPartSize ? partSize : null;
}
export function partLength(ticket: Pick<UploadTicket, 'size' | 'partSize'>, partNumber: number) {
 const count = Math.ceil(ticket.size / ticket.partSize);
 if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) return null;
 return partNumber === count ? ticket.size - (count - 1) * ticket.partSize : ticket.partSize;
}
export async function signUploadTicket(ticket: UploadTicket, secret: string) {
 const payload = encode(encoder.encode(JSON.stringify(ticket)));
 const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
 return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyUploadTicket(value: string | null, secret: string, userId: string, now = Date.now()): Promise<UploadTicket | null> {
 if (!value || value.length > 4096 || secret.length < 32) return null;
 try {
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra || !/^[\w-]+$/.test(payload) || !/^[\w-]+$/.test(signature)) return null;
  if (!await crypto.subtle.verify('HMAC', await hmacKey(secret), decode(signature), encoder.encode(payload))) return null;
  const data = JSON.parse(new TextDecoder().decode(decode(payload))) as UploadTicket;
  if (data.version !== 1 || data.userId !== userId || !/^[0-9a-f-]{36}$/i.test(data.id) || typeof data.uploadId !== 'string' || !data.uploadId || data.uploadId.length > 1024 || typeof data.filename !== 'string' || !data.filename || data.filename.length > 180 || !['pdf', 'epub'].includes(data.fileType) || (data.folderId !== null && typeof data.folderId !== 'string') || !Number.isSafeInteger(data.size) || choosePartSize(data.size) !== data.partSize || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now) return null;
  return data;
 } catch { return null; }
}

/** Compute the same SHA-256 used by existing uploads without buffering the object. */
export async function hashObject(body: ReadableStream<Uint8Array>, expectedSize: number) {
 const hash = createHash('sha256'), reader = body.getReader();
 let size = 0;
 try {
  for (;;) {
   const { value, done } = await reader.read();
   if (done) break;
   size += value.byteLength;
   if (size > expectedSize) { await reader.cancel(); throw new Error('Unexpected object size'); }
   hash.update(value);
  }
 } finally { reader.releaseLock(); }
 if (size !== expectedSize) throw new Error('Unexpected object size');
 return hash.digest('hex');
}

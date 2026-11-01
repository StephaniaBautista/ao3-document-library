export const MAX_EVIDENCE_IMAGES = 3;
export const MAX_EVIDENCE_IMAGE_BYTES = 1.5 * 1024 * 1024;
export const MAX_EVIDENCE_BODY_BYTES = 5 * 1024 * 1024;

export function parseEvidenceLinks(value: unknown): string[] | null {
 if (!Array.isArray(value) || value.length > 5) return null;
 const result: string[] = [];
 for (const item of value) {
  if (typeof item !== 'string' || item.length > 2048) return null;
  try {
   const url = new URL(item.trim());
   if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
   result.push(url.href);
  } catch { return null; }
 }
 return result;
}

export function evidenceImageType(bytes: Uint8Array): string | null {
 if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) return 'image/png';
 if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
 if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') return 'image/webp';
 return null;
}

export async function readEvidenceBody(req: Request): Promise<Uint8Array | null> {
 if (!req.body || Number(req.headers.get('content-length') || 0) > MAX_EVIDENCE_BODY_BYTES) return null;
 const reader = req.body.getReader(), chunks: Uint8Array[] = [];
 let size = 0;
 try {
  while (true) {
   const { value, done } = await reader.read();
   if (done) break;
   size += value.length;
   if (size > MAX_EVIDENCE_BODY_BYTES) { await reader.cancel(); return null; }
   chunks.push(value);
  }
 } finally { reader.releaseLock(); }
 const body = new Uint8Array(size); let offset = 0;
 for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
 return body;
}

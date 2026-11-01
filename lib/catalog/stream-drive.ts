import { createHash } from 'node:crypto';
import { choosePartSize, partLength } from './multipart.ts';

/** Stream a Drive response into R2 in bounded parts and hash the original bytes. */
export async function stageDriveFile(bucket: R2Bucket, key: string, body: ReadableStream<Uint8Array>, size: number, fileType: 'pdf' | 'epub', progress: () => Promise<unknown>) {
 const partSize = choosePartSize(size);
 if (!partSize) throw new Error('Unsupported object size');
 const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: fileType === 'pdf' ? 'application/pdf' : 'application/epub+zip' } });
 const reader = body.getReader(), hash = createHash('sha256'), parts: R2UploadedPart[] = [];
 let buffered: Uint8Array | null = null, offset = 0, total = 0;
 const prefix: number[] = [];
 try {
  const count = Math.ceil(size / partSize);
  for (let number = 1; number <= count; number++) {
   const length = partLength({ size, partSize }, number)!;
   const fixed = new FixedLengthStream(length), writer = fixed.writable.getWriter();
   const storing = upload.uploadPart(number, fixed.readable).catch(async cause => { await writer.abort(cause).catch(() => {}); throw cause; });
   const feed = (async () => {
    let remaining = length;
    try {
     while (remaining) {
      if (!buffered || offset === buffered.byteLength) {
       const next = await reader.read();
       if (next.done) throw new Error('Truncated Drive file');
       buffered = next.value; offset = 0;
       if (!buffered.byteLength) continue;
      }
      const end = Math.min(buffered.byteLength, offset + remaining), chunk = buffered.subarray(offset, end);
      for (const byte of chunk.subarray(0, Math.max(0, 5 - prefix.length))) prefix.push(byte);
      hash.update(chunk); await writer.write(chunk);
      total += chunk.byteLength; remaining -= chunk.byteLength; offset = end;
     }
     await writer.close();
    } catch (cause) { await writer.abort(cause).catch(() => {}); throw cause; }
    finally { writer.releaseLock(); }
   })();
   const [part] = await Promise.all([storing, feed]);
   parts.push(part); await progress();
  }
  const remainingBuffer = buffered as Uint8Array | null;
  if ((remainingBuffer && offset < remainingBuffer.byteLength) || !(await reader.read()).done || total !== size) throw new Error('Unexpected Drive file size');
  const valid = fileType === 'pdf' ? String.fromCharCode(...prefix) === '%PDF-' : prefix[0] === 0x50 && prefix[1] === 0x4b && prefix[2] === 3 && prefix[3] === 4;
  if (!valid) throw new Error('Unsupported file format');
  return { upload, parts, hash: hash.digest('hex') };
 } catch (cause) {
  await reader.cancel().catch(() => {});
  await upload.abort().catch(() => {});
  throw cause;
 } finally { reader.releaseLock(); }
}

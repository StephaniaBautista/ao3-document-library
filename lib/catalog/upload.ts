type UploadPart = { partNumber: number; etag: string };
type UploadResult = { id?: string; duplicate?: boolean; error?: string };

/** Upload in bounded pieces; the server validates and hashes the assembled object. */
export async function uploadLargeStory(file: File, folderId: string | null, progress: (part: number, count: number) => void): Promise<UploadResult> {
 const initial = await fetch('/api/catalog/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, size: file.size, folderId }) });
 const session = await initial.json() as { token?: string; partSize?: number; error?: string };
 if (!initial.ok || !session.token || !session.partSize) throw new Error(session.error || 'Could not start the upload.');
 const token = session.token, count = Math.ceil(file.size / session.partSize), parts: UploadPart[] = [];
 let completing = false;
 try {
  for (let index = 0; index < count; index++) {
   progress(index + 1, count);
   const chunk = file.slice(index * session.partSize, Math.min(file.size, (index + 1) * session.partSize));
   let part: UploadPart | null = null;
   for (let attempt = 0; attempt < 3 && !part; attempt++) {
    try {
     const res = await fetch('/api/catalog/uploads', { method: 'PUT', headers: { 'X-Upload-Token': token, 'X-Part-Number': String(index + 1) }, body: chunk });
     const data = await res.json() as UploadPart & { error?: string };
     if (!res.ok || data.partNumber !== index + 1 || !data.etag) throw new Error(data.error || 'Could not save the upload part.');
     part = { partNumber: data.partNumber, etag: data.etag };
    } catch (cause) { if (attempt === 2) throw cause; }
   }
   if (!part) throw new Error('Could not save the upload part.');
   parts.push(part);
  }
  completing = true;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
   try {
    const res = await fetch('/api/catalog/uploads/complete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Token': token }, body: JSON.stringify({ parts }) });
    const data = await res.json() as UploadResult;
    if (!res.ok || !data.id) throw new Error(data.error || 'Could not complete the upload.');
    return data;
   } catch (cause) { lastError = cause; }
  }
  throw lastError;
 } catch (cause) {
  // A completion response may have been lost after publication; do not delete it.
  if (!completing) await fetch('/api/catalog/uploads', { method: 'DELETE', headers: { 'X-Upload-Token': token } }).catch(() => {});
  throw cause;
 }
}

import { driveRequestHeaders, loadDriveRootFolder, validDriveId, validDriveResourceKey } from './drive-reference';

const folderType = 'application/vnd.google-apps.folder';
const shortcutType = 'application/vnd.google-apps.shortcut';
const fileTypes = new Set(['application/pdf', 'application/epub+zip']);
const maxFile = 50 * 1024 * 1024;
type Ref = { id: string; resourceKey: string | null };
type Entry = Ref & { name: string; mimeType: string; size?: string };

export function validReference(value: unknown): value is Ref {
 if (!value || typeof value !== 'object') return false;
 const ref = value as Record<string, unknown>;
 return typeof ref.id === 'string' && validDriveId(ref.id) && (ref.resourceKey === null || (typeof ref.resourceKey === 'string' && validDriveResourceKey(ref.resourceKey)));
}

/** List only supported entries. Drive credentials never leave this service. */
export async function listPrivateDriveFolder(token: string, ref: Ref, pageToken: string | null) {
 if (!validReference(ref) || (pageToken !== null && (typeof pageToken !== 'string' || pageToken.length > 2048))) throw new Error('Invalid folder');
 const folder = await loadDriveRootFolder(token, ref.id, ref.resourceKey);
 const id = folder.targetDriveId || folder.id;
 const url = new URL('https://www.googleapis.com/drive/v3/files');
 url.search = new URLSearchParams({ q: `'${id}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,size,resourceKey,shortcutDetails(targetId,targetMimeType,targetResourceKey))', pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}) }).toString();
 const response = await fetch(url, { headers: driveRequestHeaders(token, id, folder.resourceKey), redirect: 'manual', signal: AbortSignal.timeout(20000) });
 if (!response.ok) throw new Error('Cannot list folder');
 const data = await response.json() as { files?: unknown; nextPageToken?: unknown };
 if (!Array.isArray(data.files) || (data.nextPageToken != null && (typeof data.nextPageToken !== 'string' || data.nextPageToken.length > 2048))) throw new Error('Invalid Drive response');
 const entries: Entry[] = [];
 for (const raw of data.files) {
  if (!raw || typeof raw !== 'object') continue;
  const value = raw as Record<string, unknown>;
  if (typeof value.name !== 'string' || !value.name.trim()) continue;
  let id = value.id, key = value.resourceKey ?? null, mimeType = value.mimeType;
  if (mimeType === shortcutType && value.shortcutDetails && typeof value.shortcutDetails === 'object') {
   const target = value.shortcutDetails as Record<string, unknown>;
   id = target.targetId; key = target.targetResourceKey ?? null; mimeType = target.targetMimeType;
  }
  const candidate = { id, resourceKey: key };
  if (!validReference(candidate) || typeof mimeType !== 'string' || (mimeType !== folderType && !fileTypes.has(mimeType))) continue;
  const name = value.name.replace(/[\x00-\x1f/\\]/g, '_').trim().slice(0, 180);
  if (!name) continue;
  entries.push({ ...candidate, name, mimeType, ...(typeof value.size === 'string' ? { size: value.size } : {}) });
 }
 return { entries, nextPageToken: typeof data.nextPageToken === 'string' ? data.nextPageToken : null };
}

/** Stream one independently authorized PDF/EPUB, bounded by the local library's limit. */
export async function downloadPrivateDriveFile(token: string, ref: Ref) {
 if (!validReference(ref)) throw new Error('Invalid file');
 const headers = driveRequestHeaders(token, ref.id, ref.resourceKey);
 const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref.id)}`;
 const info = await fetch(`${base}?fields=id,mimeType,size,trashed&supportsAllDrives=true`, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
 if (!info.ok) throw new Error('Cannot access file');
 const meta = await info.json() as { id?: unknown; mimeType?: unknown; size?: unknown; trashed?: unknown };
 const size = typeof meta.size === 'string' && /^\d+$/.test(meta.size) ? Number(meta.size) : 0;
 if (meta.id !== ref.id || meta.trashed === true || typeof meta.mimeType !== 'string' || !fileTypes.has(meta.mimeType) || !Number.isSafeInteger(size) || size <= 0 || size > maxFile) throw new Error('Unsupported file');
 const response = await fetch(`${base}?alt=media&supportsAllDrives=true`, { headers, redirect: 'manual', signal: AbortSignal.timeout(120000) });
 if (!response.ok || !response.body) throw new Error('Cannot download file');
 let received = 0;
 const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
  transform(chunk, controller) { received += chunk.byteLength; if (received > size) throw new Error('Unexpected file size'); controller.enqueue(chunk); },
  flush() { if (received !== size) throw new Error('Incomplete file'); },
 }));
 return { stream, size, mimeType: meta.mimeType };
}

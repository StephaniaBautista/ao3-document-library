import { parseDriveFolderUrl } from './drive-reference';

type DriveRef = { id: string; resourceKey: string | null };
type DriveEntry = DriveRef & { name: string; mimeType: string; size?: string };
const driveFolder = 'application/vnd.google-apps.folder';

/** Request each file separately so large folders do not accumulate blobs in memory. */
export async function* driveFiles(folderUrl: string): AsyncGenerator<File | null> {
 const queue: Array<{ folderUrl?: string; folder?: DriveRef }> = [{ folderUrl }];
 const root = parseDriveFolderUrl(folderUrl);
 const visited = new Set<string>(root ? [root.id] : []); let count = 0, cursor = 0;
 while (cursor < queue.length) {
  const folder = queue[cursor++];
  if (folder.folder) { if (visited.has(folder.folder.id)) continue; visited.add(folder.folder.id); }
  if (visited.size > 10000) throw new Error("The collection has too many folders.");
  let pageToken: string | null = null; const pages = new Set<string>();
  do {
   const res = await fetch('/api/drive/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...folder, pageToken }) });
   const data = await res.json() as { entries?: DriveEntry[]; nextPageToken?: string | null; error?: string };
   if (!res.ok || !Array.isArray(data.entries)) throw new Error(data.error || 'Could not read the Drive folder.');
   for (const item of data.entries) {
    if (++count > 50000) throw new Error("The collection exceeds 50,000 items.");
    if (item.mimeType === driveFolder) { queue.push({ folder: { id: item.id, resourceKey: item.resourceKey } }); continue; }
    try {
     const file = await fetch('/api/drive/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, resourceKey: item.resourceKey }) });
     if (!file.ok) throw new Error('Download failed');
     const blob = await file.blob();
     const extension = item.mimeType === 'application/pdf' ? '.pdf' : '.epub';
     yield new File([blob], /\.(?:pdf|epub)$/i.test(item.name) ? item.name : `${item.name}${extension}`, { type: item.mimeType });
    } catch { yield null; }
   }
   pageToken = data.nextPageToken || null;
   if (pageToken && pages.has(pageToken)) throw new Error("Drive repeated a page of results.");
   if (pageToken) pages.add(pageToken);
  } while (pageToken);
 }
}

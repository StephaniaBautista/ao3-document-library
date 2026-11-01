export const validDriveId = (value: string) => /^[a-zA-Z0-9_-]{1,256}$/.test(value);
export const validDriveResourceKey = (value: string) => /^[a-zA-Z0-9_-]{1,256}$/.test(value);

export function parseDriveFolderUrl(value: string) {
 let url: URL;
 try { url = new URL(value.trim()); } catch { return null; }
 if (url.hostname !== 'drive.google.com' || url.protocol !== 'https:' || url.username || url.password || url.port) return null;
 const id = url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{1,256})\/?$/)?.[1];
 if (!id) return null;
 const keys = [...url.searchParams.entries()].filter(([name]) => name.toLowerCase() === 'resourcekey').map(([, key]) => key);
 if (keys.length > 1 || (keys.length && !validDriveResourceKey(keys[0]))) return null;
 return { id, resourceKey: keys[0] || null };
}

export function driveRequestHeaders(token: string, id: string, resourceKey: string | null) {
 if (!validDriveId(id) || (resourceKey !== null && !validDriveResourceKey(resourceKey))) throw new Error('Invalid Drive reference');
 return { Authorization: `Bearer ${token}`, ...(resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${id}/${resourceKey}` } : {}) };
}

/** Resolve a root folder or a shortcut to a folder without following redirects. */
export async function loadDriveRootFolder(token: string, id: string, resourceKey: string | null) {
 const headers = driveRequestHeaders(token, id, resourceKey);
 const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,resourceKey,trashed,shortcutDetails&supportsAllDrives=true`, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
 if (!response.ok) throw new Error('Cannot access folder');
 const root = await response.json() as { id?: unknown; name?: unknown; mimeType?: unknown; resourceKey?: unknown; trashed?: unknown; shortcutDetails?: { targetId?: unknown; targetResourceKey?: unknown } };
 if (root.id !== id || root.trashed === true || typeof root.name !== 'string' || !root.name.trim() || (root.resourceKey != null && (typeof root.resourceKey !== 'string' || !validDriveResourceKey(root.resourceKey)))) throw new Error('Invalid folder');
 if (root.mimeType === 'application/vnd.google-apps.folder') return { id, name: root.name, mimeType: root.mimeType, targetDriveId: null, resourceKey: resourceKey || (typeof root.resourceKey === 'string' ? root.resourceKey : null) };
 if (root.mimeType !== 'application/vnd.google-apps.shortcut') throw new Error('Invalid folder');
 const target = root.shortcutDetails;
 if (!target || typeof target.targetId !== 'string' || !validDriveId(target.targetId) || (target.targetResourceKey != null && (typeof target.targetResourceKey !== 'string' || !validDriveResourceKey(target.targetResourceKey)))) throw new Error('Invalid folder shortcut');
 const key = typeof target.targetResourceKey === 'string' ? target.targetResourceKey : null;
 const targetResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(target.targetId)}?fields=id,mimeType,trashed&supportsAllDrives=true`, { headers: driveRequestHeaders(token, target.targetId, key), redirect: 'manual', signal: AbortSignal.timeout(15000) });
 if (!targetResponse.ok) throw new Error('Cannot access folder');
 const destination = await targetResponse.json() as { id?: unknown; mimeType?: unknown; trashed?: unknown };
 if (destination.id !== target.targetId || destination.mimeType !== 'application/vnd.google-apps.folder' || destination.trashed === true) throw new Error('Invalid folder shortcut');
 return { id, name: root.name, mimeType: 'application/vnd.google-apps.folder', targetDriveId: target.targetId, resourceKey: key };
}

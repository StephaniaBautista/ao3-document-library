import { stageDriveFile } from './stream-drive.ts';
import { flushObjectDeletion } from './object-deletions.ts';
import { driveRequestHeaders, validDriveId, validDriveResourceKey } from './drive-reference.ts';

type ImportEnv = Pick<Cloudflare.Env, 'DB' | 'BUCKET' | 'LIBRARY_ADMIN_USER_ID'>;
type Item = { id: string; jobId: string; driveId: string; targetDriveId: string | null; resourceKey: string | null; parentItemId: string | null; name: string; mimeType: string; parentFolderId: string | null; catalogFolderId: string | null; pageToken: string | null; userId: string };
type DriveFile = { id?: unknown; name?: unknown; mimeType?: unknown; size?: unknown; resourceKey?: unknown; shortcutDetails?: { targetId?: unknown; targetMimeType?: unknown; targetResourceKey?: unknown } };
const folderType = 'application/vnd.google-apps.folder';
const shortcutType = 'application/vnd.google-apps.shortcut';
const supportedType = (type: unknown): type is string => type === folderType || type === 'application/pdf' || type === 'application/epub+zip';
const safeName = (value: string) => value.replace(/[\x00-\x1f/\\]/g, '_').trim().slice(0, 180);
class ImportIssue extends Error {}
class SkippedImport extends Error {}

export async function processDriveImports(env: ImportEnv, getAccessToken: (userId: string, db: D1Database) => Promise<string>, max = 10, jobId?: string) {
 if (!env.DB || !env.BUCKET || !env.LIBRARY_ADMIN_USER_ID) return;
 const db = env.DB, bucket = env.BUCKET;
 await db.prepare("UPDATE drive_import_items SET state = 'pending', updated_at = ? WHERE state = 'processing' AND updated_at < ? AND (? IS NULL OR job_id = ?)").bind(Date.now(), Date.now() - 600_000, jobId ?? null, jobId ?? null).run();
 const pending = await db.prepare("SELECT i.id, i.job_id AS jobId, i.drive_id AS driveId, i.target_drive_id AS targetDriveId, i.resource_key AS resourceKey, i.parent_item_id AS parentItemId, i.name, i.mime_type AS mimeType, i.parent_folder_id AS parentFolderId, i.catalog_folder_id AS catalogFolderId, i.page_token AS pageToken, j.user_id AS userId FROM drive_import_items i JOIN drive_import_jobs j ON j.id = i.job_id JOIN library_profiles p ON p.user_id = j.user_id WHERE i.state = 'pending' AND j.user_id = ? AND p.blocked = 0 AND p.age_verified = 1 AND (? IS NULL OR j.id = ?) ORDER BY i.updated_at LIMIT ?").bind(env.LIBRARY_ADMIN_USER_ID, jobId ?? null, jobId ?? null, max).all<Item>();
 for (const item of pending.results) {
  const claim = await db.prepare("UPDATE drive_import_items SET state = 'processing', updated_at = ? WHERE id = ? AND state = 'pending' RETURNING id").bind(Date.now(), item.id).first();
  if (!claim) continue;
  try {
   if (!validDriveId(item.driveId)) throw new Error('Invalid Drive identifier');
   if (item.parentItemId && !item.parentFolderId) throw new ImportIssue("The destination folder no longer exists. Start a new import.");
   const token = await getAccessToken(item.userId, db);
   let targetChecked = false;
   if (item.mimeType === shortcutType) {
    const shortcut = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.driveId)}?fields=id,shortcutDetails&supportsAllDrives=true`, { headers: driveRequestHeaders(token, item.driveId, item.resourceKey), redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!shortcut.ok) throw new ImportIssue('Could not access the shortcut.');
    const value = await shortcut.json() as DriveFile;
    const details = value.shortcutDetails;
    if (value.id !== item.driveId || !details || typeof details.targetId !== 'string' || !validDriveId(details.targetId) || (details.targetResourceKey != null && (typeof details.targetResourceKey !== 'string' || !validDriveResourceKey(details.targetResourceKey)))) throw new ImportIssue('The shortcut has no accessible destination.');
    item.targetDriveId = details.targetId; item.resourceKey = typeof details.targetResourceKey === 'string' ? details.targetResourceKey : null;
    const target = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.targetDriveId)}?fields=id,mimeType,trashed&supportsAllDrives=true`, { headers: driveRequestHeaders(token, item.targetDriveId, item.resourceKey), redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!target.ok) throw new ImportIssue('Could not access the shortcut destination.');
    const destination = await target.json() as { id?: unknown; mimeType?: unknown; trashed?: unknown };
    if (destination.id !== item.targetDriveId || destination.trashed === true || typeof destination.mimeType !== 'string') throw new ImportIssue("The shortcut destination changed or is no longer available.");
    if (!supportedType(destination.mimeType)) throw new SkippedImport();
    item.mimeType = destination.mimeType; targetChecked = true;
    await db.prepare('UPDATE drive_import_items SET target_drive_id = ?, mime_type = ?, resource_key = ? WHERE id = ?').bind(item.targetDriveId, item.mimeType, item.resourceKey, item.id).run();
   }
   const sourceId = item.targetDriveId || item.driveId;
   const headers = driveRequestHeaders(token, sourceId, item.resourceKey);
   if (item.targetDriveId && !targetChecked) {
    const target = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sourceId)}?fields=id,mimeType,trashed&supportsAllDrives=true`, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!target.ok) throw new ImportIssue('Could not access the shortcut destination.');
    const value = await target.json() as { id?: unknown; mimeType?: unknown; trashed?: unknown };
    if (value.id !== sourceId || value.mimeType !== item.mimeType || value.trashed === true) throw new ImportIssue("The shortcut destination changed or is no longer available.");
   }
   if (item.mimeType === folderType) {
    if (item.parentItemId) {
     const cycle = await db.prepare('WITH RECURSIVE ancestors(id, drive_id, target_drive_id, parent_item_id) AS (SELECT id, drive_id, target_drive_id, parent_item_id FROM drive_import_items WHERE id = ? UNION SELECT p.id, p.drive_id, p.target_drive_id, p.parent_item_id FROM drive_import_items p JOIN ancestors a ON p.id = a.parent_item_id) SELECT id FROM ancestors WHERE COALESCE(target_drive_id, drive_id) = ? LIMIT 1').bind(item.parentItemId, sourceId).first();
     if (cycle) throw new ImportIssue('The shortcut creates a folder cycle.');
    }
    let folderId = item.catalogFolderId;
    if (!folderId) {
     const existing = await db.prepare('SELECT id FROM shared_folders WHERE parent_id IS ? AND name = ? COLLATE NOCASE').bind(item.parentFolderId, safeName(item.name)).first<{ id: string }>();
     folderId = existing?.id || crypto.randomUUID();
     if (existing) await db.prepare('UPDATE drive_import_items SET catalog_folder_id = ? WHERE id = ?').bind(folderId, item.id).run();
     else {
      try { await db.batch([db.prepare('INSERT INTO shared_folders (id, parent_id, name, created_at) SELECT ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM shared_folders WHERE id = ?)').bind(folderId, item.parentFolderId, safeName(item.name), Date.now(), item.parentFolderId, item.parentFolderId), db.prepare('UPDATE drive_import_items SET catalog_folder_id = ? WHERE id = ?').bind(folderId, item.id)]); }
      catch (cause) {
       const concurrent = await db.prepare('SELECT id FROM shared_folders WHERE parent_id IS ? AND name = ? COLLATE NOCASE').bind(item.parentFolderId, safeName(item.name)).first<{ id: string }>();
       if (!concurrent) throw cause;
       folderId = concurrent.id;
       await db.prepare('UPDATE drive_import_items SET catalog_folder_id = ? WHERE id = ?').bind(folderId, item.id).run();
      }
     }
    }
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.search = new URLSearchParams({ q: `'${sourceId}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,size,resourceKey,shortcutDetails(targetId,targetMimeType,targetResourceKey))', pageSize: '50', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(item.pageToken ? { pageToken: item.pageToken } : {}) }).toString();
    const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('Could not list Drive folder');
    const payload = await res.json() as { files?: DriveFile[]; nextPageToken?: string };
    if (!Array.isArray(payload.files)) throw new Error('Invalid Drive response');
    const statements = payload.files.filter(file => typeof file.id === 'string' && validDriveId(file.id) && typeof file.name === 'string' && safeName(file.name) && (supportedType(file.mimeType) || file.mimeType === shortcutType)).map(file => db.prepare('INSERT OR IGNORE INTO drive_import_items (id, job_id, drive_id, name, mime_type, resource_key, parent_item_id, parent_folder_id, state, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), item.jobId, file.id, safeName(file.name as string), file.mimeType, typeof file.resourceKey === 'string' ? file.resourceKey : null, item.id, folderId, 'pending', Date.now()));
    statements.push(db.prepare("UPDATE drive_import_items SET state = ?, page_token = ?, resource_key = CASE WHEN ? = 'done' THEN NULL ELSE resource_key END, updated_at = ? WHERE id = ?").bind(payload.nextPageToken ? 'pending' : 'done', payload.nextPageToken || null, payload.nextPageToken ? 'pending' : 'done', Date.now(), item.id));
    await db.batch(statements);
   } else {
    const storyId = item.id, key = `catalog/${storyId}`;
    const handled = await db.prepare('SELECT 1 AS found WHERE EXISTS (SELECT 1 FROM shared_stories WHERE id = ?) OR EXISTS (SELECT 1 FROM object_deletions WHERE object_key = ?)').bind(storyId, key).first();
    if (handled) {
     await db.prepare("UPDATE drive_import_items SET state = 'done', resource_key = NULL, story_id = COALESCE(story_id, (SELECT id FROM shared_stories WHERE id = ?)), updated_at = ? WHERE id = ?").bind(item.id, Date.now(), item.id).run();
    } else {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sourceId)}?alt=media&supportsAllDrives=true`, { headers, redirect: 'manual', signal: AbortSignal.timeout(12 * 60 * 1000) });
    if (!res.ok) throw new Error('Could not download Drive file');
    let length = Number(res.headers.get('content-length') || 0);
    if (!Number.isSafeInteger(length) || length <= 0) {
     const info = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sourceId)}?fields=id,size&supportsAllDrives=true`, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
     if (!info.ok) throw new Error('Missing Drive file size');
     const metadata = await info.json() as { id?: string; size?: string };
     if (metadata.id !== sourceId) throw new Error('Unexpected Drive file');
     length = Number(metadata.size);
    }
    if (!res.body || !Number.isSafeInteger(length) || length <= 0) throw new Error('Missing Drive file size');
    const pdf = item.mimeType === 'application/pdf';
    const staged = await stageDriveFile(bucket, key, res.body, length, pdf ? 'pdf' : 'epub', () => db.prepare("UPDATE drive_import_items SET updated_at = ? WHERE id = ? AND state = 'processing'").bind(Date.now(), item.id).run());
    let finished = false;
    try {
     const { hash } = staged;
     const existing = await db.prepare('SELECT id FROM shared_stories WHERE content_hash = ?').bind(hash).first<{ id: string }>();
     if (!existing) {
      await staged.upload.complete(staged.parts); finished = true;
      try {
       const [inserted] = await db.batch([
        db.prepare('INSERT INTO shared_stories (id, folder_id, submitted_by, filename, file_type, size, object_key, content_hash, title, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM object_deletions WHERE object_key = ?)').bind(storyId, item.parentFolderId, item.userId, safeName(item.name), pdf ? 'pdf' : 'epub', length, key, hash, safeName(item.name).replace(/\.(pdf|epub)$/i, ''), Date.now(), key),
        db.prepare('UPDATE drive_import_items SET story_id = ?, duplicate = 0 WHERE id = ? AND EXISTS (SELECT 1 FROM shared_stories WHERE id = ?)').bind(storyId, item.id, storyId),
       ]);
       if (!inserted.meta.changes) {
        await db.prepare('UPDATE object_deletions SET deleted_at = NULL WHERE object_key = ?').bind(key).run();
        await flushObjectDeletion(db, bucket, key);
       }
      } catch (cause) {
       const same = await db.prepare('SELECT id FROM shared_stories WHERE id = ? AND object_key = ?').bind(storyId, key).first();
       if (!same) await bucket.delete(key);
       const match = same || await db.prepare('SELECT id FROM shared_stories WHERE content_hash = ?').bind(hash).first<{ id: string }>();
       if (!match) throw cause;
       const linked = await db.prepare('UPDATE drive_import_items SET story_id = ?, duplicate = ? WHERE id = ? AND EXISTS (SELECT 1 FROM shared_stories WHERE id = ?) RETURNING id').bind(match.id, match.id === item.id ? 0 : 1, item.id, match.id).first();
       if (!linked) throw cause;
      }
     } else {
      const linked = await db.prepare('UPDATE drive_import_items SET story_id = ?, duplicate = ? WHERE id = ? AND EXISTS (SELECT 1 FROM shared_stories WHERE id = ?) RETURNING id').bind(existing.id, existing.id === item.id ? 0 : 1, item.id, existing.id).first();
      if (!linked) throw new Error('Duplicate changed while importing');
      await staged.upload.abort(); finished = true;
      if (existing.id !== item.id) await bucket.delete(key);
     }
    } finally { if (!finished) await staged.upload.abort().catch(() => {}); }
    await db.prepare("UPDATE drive_import_items SET state = 'done', resource_key = NULL, updated_at = ? WHERE id = ?").bind(Date.now(), item.id).run();
    }
   }
  } catch (cause) {
   await db.prepare("UPDATE drive_import_items SET state = ?, error = ?, resource_key = CASE WHEN ? = 'done' THEN NULL ELSE resource_key END, updated_at = ? WHERE id = ?").bind(cause instanceof SkippedImport ? 'done' : 'failed', cause instanceof SkippedImport ? null : cause instanceof ImportIssue ? cause.message : 'Could not import this item.', cause instanceof SkippedImport ? 'done' : 'failed', Date.now(), item.id).run();
  }
  const remaining = await db.prepare("SELECT state, count(*) AS count FROM drive_import_items WHERE job_id = ? GROUP BY state").bind(item.jobId).all<{ state: string; count: number }>();
  const active = remaining.results.some(row => row.state === 'pending' || row.state === 'processing');
  if (!active) await db.prepare('UPDATE drive_import_jobs SET state = ? WHERE id = ?').bind(remaining.results.some(row => row.state === 'failed') ? 'failed' : 'done', item.jobId).run();
 }
}

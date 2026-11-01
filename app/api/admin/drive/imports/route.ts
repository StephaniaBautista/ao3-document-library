import { catalogAccess } from '@/lib/catalog/access';
import { refreshDriveAccessToken } from '@/lib/catalog/drive';
import { loadDriveRootFolder, parseDriveFolderUrl } from '@/lib/catalog/drive-reference';
export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 let body: { folderUrl?: unknown; folderUrls?: unknown };
 try { body = await req.json(); } catch { return error('Invalid request.'); }
 const urls = body?.folderUrls ?? (typeof body?.folderUrl === 'string' ? [body.folderUrl] : null);
 if (!Array.isArray(urls) || !urls.length || urls.length > 100 || urls.some(value => typeof value !== 'string')) return error('Provide between 1 and 100 Drive folder URLs.');
 const references = new Map<string, string | null>();
 for (const value of urls) {
  const reference = parseDriveFolderUrl(value);
  if (!reference) return error('Invalid Drive folder URL.');
  const previous = references.get(reference.id);
  if (previous && reference.resourceKey && previous !== reference.resourceKey) return error('Conflicting Drive resource keys.');
  references.set(reference.id, reference.resourceKey || previous || null);
 }
 try {
  const token = await refreshDriveAccessToken(access.context.userId, access.context.db);
  const folders: Awaited<ReturnType<typeof loadDriveRootFolder>>[] = [];
  const entries = [...references.entries()];
  for (let offset = 0; offset < entries.length; offset += 5) {
   folders.push(...await Promise.all(entries.slice(offset, offset + 5).map(([id, key]) => loadDriveRootFolder(token, id, key))));
  }
  const jobId = crypto.randomUUID(), now = Date.now();
  await access.context.db.batch([
   access.context.db.prepare('INSERT INTO drive_import_jobs (id, user_id, created_at) VALUES (?, ?, ?)').bind(jobId, access.context.userId, now),
   ...folders.map(folder => access.context.db.prepare('INSERT INTO drive_import_items (id, job_id, drive_id, name, mime_type, target_drive_id, resource_key, state, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), jobId, folder.id, folder.name.replace(/[\x00-\x1f/\\]/g, '_').trim().slice(0, 180), folder.mimeType, folder.targetDriveId, folder.resourceKey, 'pending', now)),
  ]);
  return Response.json({ id: jobId }, { status: 201 });
 } catch { return error("One or more folders could not be accessed. Check the connected account and its permissions; the import was not started.", 503); }
}

export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 if (access.context.role !== 'admin') return error('Forbidden.', 403);
 const jobs = await access.context.db.prepare('SELECT id, state, created_at AS createdAt FROM drive_import_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(access.context.userId).all();
 return Response.json({ jobs: jobs.results });
}

import { catalogAccess } from '@/lib/catalog/access';
import { refreshDriveAccessToken } from '@/lib/catalog/drive';
import { parseDriveFolderUrl } from '@/lib/catalog/drive-reference';
import { listPrivateDriveFolder, validReference } from '@/lib/catalog/private-drive';

export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 let body: { folderUrl?: unknown; folder?: unknown; pageToken?: unknown };
 try { body = await req.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
 const ref = typeof body.folderUrl === 'string' ? parseDriveFolderUrl(body.folderUrl) : body.folder;
 if (!validReference(ref) || !(body.pageToken == null || typeof body.pageToken === 'string')) return Response.json({ error: "Invalid folder link." }, { status: 400 });
 try {
  const token = await refreshDriveAccessToken(access.context.userId, access.context.db, 'private');
  const result = await listPrivateDriveFolder(token, ref, body.pageToken ?? null);
  return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
 } catch { return Response.json({ error: 'Could not access the folder. Connect Drive and check its permissions.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}

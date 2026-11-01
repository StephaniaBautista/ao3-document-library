import { catalogAccess } from '@/lib/catalog/access';
import { refreshDriveAccessToken } from '@/lib/catalog/drive';
import { downloadPrivateDriveFile, validReference } from '@/lib/catalog/private-drive';

export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 let body: unknown;
 try { body = await req.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
 if (!validReference(body)) return Response.json({ error: "Invalid file." }, { status: 400 });
 try {
  const token = await refreshDriveAccessToken(access.context.userId, access.context.db, 'private');
  const file = await downloadPrivateDriveFile(token, body);
  return new Response(file.stream, { headers: { 'Content-Type': file.mimeType, 'Content-Length': String(file.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
 } catch { return Response.json({ error: 'Could not download the file, or it exceeds 50 MB.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}

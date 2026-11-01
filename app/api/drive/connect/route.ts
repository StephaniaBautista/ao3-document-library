import { catalogAccess } from '@/lib/catalog/access';
import { createConnection } from '@/lib/catalog/drive-connect';
import { decryptToken } from '@/lib/catalog/drive';
import { revokeDriveConnection } from '@/lib/catalog/revoke-drive.mjs';

export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 return createConnection(access.context.userId, 'private');
}

export async function DELETE(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 try {
  await revokeDriveConnection(access.context.db, access.context.userId, 'private', decryptToken);
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
 } catch { return Response.json({ error: 'Could not revoke the Google Drive connection. Please try again.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}

import { catalogAccess } from '@/lib/catalog/access';
import { driveSettings, encryptToken, decryptToken, hashState } from '@/lib/catalog/drive';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const url = new URL(req.url), state = url.searchParams.get('state'), code = url.searchParams.get('code');
 if (!state || !code || state.length > 100 || code.length > 4096) return new Response('Invalid authorization response.', { status: 400 });
 const privateConnection = state.startsWith('private.');
 if (!privateConnection && access.context.role !== 'admin') return new Response('Forbidden', { status: 403 });
 const db = access.context.db;
 const consumed = await db.prepare('DELETE FROM drive_oauth_states WHERE state_hash = ? AND user_id = ? AND expires_at > ? RETURNING verifier_ciphertext AS verifier').bind(await hashState(state), access.context.userId, Date.now()).first<{ verifier: string | null }>();
 if (!consumed?.verifier) return new Response('Authorization expired.', { status: 400 });
 try {
  const settings = driveSettings();
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: settings.clientId, client_secret: settings.clientSecret, redirect_uri: settings.redirectUri, grant_type: 'authorization_code', code_verifier: await decryptToken(consumed.verifier) }), redirect: 'manual', signal: AbortSignal.timeout(15000) });
  if (!tokenResponse.ok) throw new Error('Authorization failed');
  const token = await tokenResponse.json() as { refresh_token?: unknown };
  if (typeof token.refresh_token !== 'string' || !token.refresh_token) throw new Error('Missing refresh token');
  const cipher = await encryptToken(token.refresh_token);
  const sql = privateConnection
   ? 'INSERT INTO private_drive_connections (user_id, refresh_token_ciphertext, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET refresh_token_ciphertext = excluded.refresh_token_ciphertext, created_at = excluded.created_at'
   : 'INSERT INTO drive_connections (user_id, refresh_token_ciphertext, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET refresh_token_ciphertext = excluded.refresh_token_ciphertext, created_at = excluded.created_at';
  await db.prepare(sql).bind(access.context.userId, cipher, Date.now()).run();
  return new Response(null, { status: 303, headers: { Location: new URL('/', req.url).toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
 } catch { return new Response('Could not connect Google Drive.', { status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }); }
}

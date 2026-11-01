import { env } from 'cloudflare:workers';
import { driveSettings, hashState, encryptToken } from '@/lib/catalog/drive';
import { newCodeVerifier, codeChallenge } from '@/lib/catalog/pkce.mjs';

export async function createConnection(userId: string, purpose: 'admin' | 'private' = 'admin') {
 try {
  const settings = driveSettings();
  const state = `${purpose}.` + crypto.randomUUID() + crypto.randomUUID();
  const verifier = newCodeVerifier();
  await env.DB!.prepare('DELETE FROM drive_oauth_states WHERE expires_at < ?').bind(Date.now()).run();
  await env.DB!.prepare('INSERT INTO drive_oauth_states (state_hash, user_id, expires_at, verifier_ciphertext) VALUES (?, ?, ?, ?)').bind(await hashState(state), userId, Date.now() + 600000, await encryptToken(verifier)).run();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: settings.redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.readonly', access_type: 'offline', prompt: 'consent', code_challenge: await codeChallenge(verifier), code_challenge_method: 'S256', state }).toString();
  return Response.json({ url: url.toString() }, { headers: { 'Cache-Control': 'no-store' } });
 } catch { return Response.json({ error: 'Google Drive is not configured.' }, { status: 503 }); }
}

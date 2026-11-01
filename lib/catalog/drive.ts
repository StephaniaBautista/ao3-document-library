import { env } from 'cloudflare:workers';
const encode64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export const hashState = async (value: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
async function key() {
 if (!env.DRIVE_TOKEN_ENCRYPTION_KEY) throw new Error('Drive encryption not configured');
 const raw = decode64(env.DRIVE_TOKEN_ENCRYPTION_KEY);
 if (raw.length !== 32) throw new Error('Drive encryption not configured');
 return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptToken(value: string) {
 const nonce = crypto.getRandomValues(new Uint8Array(12));
 const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await key(), new TextEncoder().encode(value)));
 return `${encode64(nonce)}.${encode64(encrypted)}`;
}
export async function decryptToken(value: string) {
 const [iv, ciphertext, extra] = value.split('.');
 if (!iv || !ciphertext || extra) throw new Error('Invalid encrypted token');
 const result = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode64(iv) }, await key(), decode64(ciphertext));
 return new TextDecoder().decode(result);
}
export function driveSettings() {
 if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.BETTER_AUTH_URL || !env.DRIVE_TOKEN_ENCRYPTION_KEY) throw new Error('Drive not configured');
 const base = new URL(env.BETTER_AUTH_URL);
 if (base.protocol !== 'https:' && base.hostname !== '127.0.0.1' && base.hostname !== 'localhost') throw new Error('Invalid application URL');
 return { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET, redirectUri: new URL('/api/admin/drive/callback', base).toString() };
}
export async function refreshDriveAccessToken(userId: string, db: D1Database, purpose: 'admin' | 'private' = 'admin'): Promise<string> {
 const settings = driveSettings();
 const query = purpose === 'private' ? 'SELECT refresh_token_ciphertext AS token FROM private_drive_connections WHERE user_id = ?' : 'SELECT refresh_token_ciphertext AS token FROM drive_connections WHERE user_id = ?';
 const connection = await db.prepare(query).bind(userId).first<{ token: string }>();
 if (!connection) throw new Error('Drive account not connected');
 const token = await decryptToken(connection.token);
 const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: settings.clientId, client_secret: settings.clientSecret }), redirect: 'manual', signal: AbortSignal.timeout(15000) });
 if (!res.ok) throw new Error('Drive authentication failed');
 const data = await res.json() as { access_token?: unknown };
 if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('Drive authentication failed');
 return data.access_token;
}

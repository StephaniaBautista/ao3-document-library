const enc = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decode(value: string) { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0)); }
async function key(secret: string) { return crypto.subtle.importKey('raw', enc.encode(`extractor-file-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function issueExtractorTicket(id: string, secret: string, expiresAt: number) {
 if (!/^[\w-]{1,128}$/.test(id) || secret.length < 32 || !Number.isSafeInteger(expiresAt)) throw new Error('Invalid extractor ticket');
 const message = `${id}.${expiresAt}`;
 return `${message}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(message))))}`;
}
export async function verifyExtractorTicket(token: string | null, id: string, secret: string, now = Date.now()) {
 if (!token || token.length > 512 || secret.length < 32) return false;
 try {
  const [tokenId, expiry, signature, extra] = token.split('.');
  if (extra || tokenId !== id || !/^[\w-]{1,128}$/.test(tokenId) || !/^\d{1,16}$/.test(expiry) || !/^[\w-]+$/.test(signature) || Number(expiry) <= now || Number(expiry) > now + 15 * 60 * 1000) return false;
  return await crypto.subtle.verify('HMAC', await key(secret), decode(signature), enc.encode(`${tokenId}.${expiry}`));
 } catch { return false; }
}

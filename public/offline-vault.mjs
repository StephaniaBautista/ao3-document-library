// Offline files are encrypted with a password that is never sent to the server.
const iterations = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function deriveKey(password, salt, usages) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Use an offline password of at least 12 characters.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, usages);
}

export async function sealOffline(value, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return { version: 1, salt, iv, ciphertext };
}

export async function openOffline(sealed, password) {
  if (!sealed || sealed.version !== 1 || !(sealed.salt instanceof Uint8Array) || sealed.salt.length !== 16 || !(sealed.iv instanceof Uint8Array) || sealed.iv.length !== 12 || !(sealed.ciphertext instanceof ArrayBuffer)) throw new Error('This protected story is not supported.');
  const key = await deriveKey(password, sealed.salt, ['decrypt']);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.ciphertext);
    return JSON.parse(decoder.decode(plaintext));
  } catch { throw new Error('Incorrect offline password or damaged data.'); }
}

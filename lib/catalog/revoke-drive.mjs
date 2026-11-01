/** Revoke before deleting; retain the credential when the provider outcome is unknown. */
export async function revokeDriveConnection(db, userId, purpose, decrypt, fetcher = fetch) {
 const table = purpose === 'private' ? 'private_drive_connections' : purpose === 'admin' ? 'drive_connections' : null;
 if (!table) throw new Error('Invalid connection type');
 const row = await db.prepare(`SELECT refresh_token_ciphertext AS token FROM ${table} WHERE user_id = ?`).bind(userId).first();
 if (!row) return;
 const token = await decrypt(row.token);
 const response = await fetcher('https://oauth2.googleapis.com/revoke', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ token }), redirect: 'manual', signal: AbortSignal.timeout(15000),
 });
 if (!response.ok) {
  const body = response.status === 400 ? await response.json().catch(() => ({})) : {};
  if (body.error !== 'invalid_token') throw new Error('Drive authorization revocation unavailable');
 }
 // A concurrently replaced connection must never be deleted.
 const result = await db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND refresh_token_ciphertext = ?`).bind(userId, row.token).run();
 if (!result.meta.changes) throw new Error('Drive connection changed during revocation');
}

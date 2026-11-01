/** Record the user's own declaration. This does not independently verify age.
 * The existing age_verified column is retained for database compatibility. */
export async function recordAdultDeclaration(db: D1Database, userId: string, now = Date.now()) {
 await db.prepare('INSERT OR IGNORE INTO library_profiles (user_id, created_at) SELECT id, ? FROM user WHERE id = ? AND email_verified = 1').bind(now, userId).run();
 const result = await db.prepare("UPDATE library_profiles SET age_verified = 1, age_verification_state = 'self_declared', age_verification_next_check_at = NULL WHERE user_id = ? AND blocked = 0 AND EXISTS (SELECT 1 FROM user WHERE id = ? AND email_verified = 1) RETURNING user_id")
  .bind(userId, userId).first();
 return !!result;
}

export async function handleAdultDeclaration(req: Request, getUser: () => Promise<{ id: string; emailVerified: boolean } | null | undefined>, db: D1Database | undefined) {
 const response = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
 if (req.headers.get('origin') !== new URL(req.url).origin) return response({ error: 'Invalid request origin.' }, 403);
 const user = await getUser();
 if (!user?.emailVerified) return response({ error: 'Verified account required.' }, 401);
 if (!db) return response({ error: 'Library unavailable.' }, 503);
 const body = await req.json().catch(() => null) as { confirmed?: unknown } | null;
 if (body?.confirmed !== true) return response({ error: 'Adult declaration required.' }, 400);
 if (!await recordAdultDeclaration(db, user.id)) return response({ error: 'Account unavailable.' }, 403);
 return response({ status: 'confirmed' });
}

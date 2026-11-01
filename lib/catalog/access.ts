import { env } from 'cloudflare:workers';
import { getAuth } from '@/lib/auth';

export type CatalogContext = { userId: string; role: 'admin' | 'moderator' | 'user'; db: D1Database; bucket: R2Bucket };
export type CatalogAccess = { context: CatalogContext; error?: never } | { context?: never; error: Response };
const error = (message: string, status: number) => Response.json({ error: message }, { status });

/** The legacy age_verified flag records a user's declaration or an earlier provider result. */
export async function catalogAccess(req: Request, write = false): Promise<CatalogAccess> {
 if (write && req.headers.get('origin') !== new URL(req.url).origin) return { error: error('Invalid request origin.', 403) };
 const user = (await getAuth().api.getSession({ headers: req.headers }))?.user;
 if (!user?.emailVerified) return { error: error('Verified account required.', 401) };
 if (!env.DB || !env.BUCKET) return { error: error('Library unavailable.', 503) };
 const profile = await env.DB.prepare('SELECT role, blocked, age_verified AS ageVerified FROM library_profiles WHERE user_id = ?')
  .bind(user.id).first<{ role: string; blocked: number; ageVerified: number }>();
 if (profile?.blocked) return { error: error('Account unavailable.', 403) };
 if (!profile?.ageVerified) return { error: error('Adult declaration required.', 403) };
 const role = env.LIBRARY_ADMIN_USER_ID === user.id ? 'admin' : profile.role === 'moderator' ? 'moderator' : 'user';
 return { context: { userId: user.id, role, db: env.DB, bucket: env.BUCKET } };
}

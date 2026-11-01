import { headers } from 'next/headers';
import { env } from 'cloudflare:workers';
import AgeVerification from './age-verification';
import { getAuth } from '@/lib/auth';
import AccessLayout from './access-layout';
import AuthForm from './auth-form';
import SimpleLibrary from './simple-library';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = (await getAuth().api.getSession({ headers: await headers() }))?.user;
  if (user?.emailVerified) {
    const profile = await env.DB?.prepare('SELECT blocked, role, age_verified AS ageVerified FROM library_profiles WHERE user_id = ?').bind(user.id).first<{ blocked: number; ageVerified: number; role: string }>();
    if (!profile?.ageVerified || profile.blocked) return <AccessLayout><AgeVerification userId={user.id} blocked={!!profile?.blocked} /></AccessLayout>;
    const role = env.LIBRARY_ADMIN_USER_ID === user.id ? 'admin' : profile.role === 'moderator' ? 'moderator' : 'user';
    return <SimpleLibrary user={{ id: user.id, name: user.name, email: user.email, role }} />;
  }
  return <AccessLayout><AuthForm /></AccessLayout>;
}

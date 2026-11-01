import { env } from 'cloudflare:workers';
import { catalogAccess } from '@/lib/catalog/access';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 if (!env.GOOGLE_TRANSLATE_API_KEY) return Response.json({ error: 'Translation is not configured yet.' }, { status: 503 });
 try {
  const res = await fetch('https://translation.googleapis.com/language/translate/v2/languages?target=en', { headers: { 'x-goog-api-key': env.GOOGLE_TRANSLATE_API_KEY }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('Translation unavailable');
  const data = await res.json() as { data?: { languages?: { language: string; name: string }[] } };
  if (!Array.isArray(data.data?.languages)) throw new Error('Invalid response');
  return Response.json({ languages: data.data.languages });
 } catch { return Response.json({ error: 'Could not load languages.' }, { status: 503 }); }
}

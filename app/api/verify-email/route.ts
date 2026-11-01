import { env } from 'cloudflare:workers';
import { getAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
 if (req.headers.get('origin') !== new URL(req.url).origin || !env.BETTER_AUTH_URL) return new Response(null, {status: 403});
 if (!req.body || Number(req.headers.get('content-length') || 0) > 10000) return new Response(null, {status: 400});
 const reader = req.body.getReader();
 let body = '', bytes = 0;
 const decoder = new TextDecoder();
 while (true) {
   const {done, value} = await reader.read();
   if (done) break;
   bytes += value.byteLength;
   if (bytes > 10000) { await reader.cancel(); return new Response(null, {status: 400}); }
   body += decoder.decode(value, {stream: true});
 }
 body += decoder.decode();
 let token: unknown;
 try { token = (JSON.parse(body) as {token?:unknown}).token; } catch { return new Response(null, {status: 400}); }
 if (typeof token !== 'string' || !token || token.length > 8192) return new Response(null, {status: 400});
 // Invoke Better Auth internally so the token is not exposed in a request URL or access log.
 const internalUrl = new URL('/api/auth/verify-email', env.BETTER_AUTH_URL);
 internalUrl.searchParams.set('token', token);
 const result = await getAuth().handler(new Request(internalUrl, {method:'GET', headers: req.headers}));
 return Response.json({ok: result.ok}, {status: result.ok ? 200 : result.status, headers: {'Cache-Control':'no-store'}});
}

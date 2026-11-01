import { catalogAccess } from '@/lib/catalog/access';
import { env } from 'cloudflare:workers';
import { getAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, {params}: {params: Promise<{id:string}>}) {
 const access = await catalogAccess(req); if (access.error) return access.error;
 const user = (await getAuth().api.getSession({ headers: req.headers }))?.user; if (!user?.emailVerified || !env.DB || !env.BUCKET) return new Response('Unauthorized', {status:401});
 const {id} = await params;
 const row = await env.DB.prepare('SELECT name, type, object_key as objectKey FROM files WHERE id = ? AND owner = ?').bind(id,user.id).first<{name:string;type:string;objectKey:string}>();
 if (!row) return new Response('Not found',{status:404});
 const object = await env.BUCKET.get(row.objectKey); if (!object) return new Response('Not found',{status:404});
 const download = new URL(req.url).searchParams.has('download');
 return new Response(object.body,{headers:{'Content-Type':row.type === 'pdf' ? 'application/pdf' : 'application/epub+zip','Content-Disposition':`${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox"}});
}

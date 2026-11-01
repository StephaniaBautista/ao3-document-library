import { env } from 'cloudflare:workers';
import { getAuth } from '@/lib/auth';
import { handleAdultDeclaration } from '@/lib/catalog/age-declaration';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
 return handleAdultDeclaration(req, async () => (await getAuth().api.getSession({ headers: req.headers }))?.user, env.DB);
}

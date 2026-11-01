import { issueExtractorTicket } from './extractor-ticket';

type Env = Pick<Cloudflare.Env, 'BETTER_AUTH_URL' | 'EXTRACTOR_TOKEN'>;
export async function largeExtractionRequest(env: Env, storyId: string, fileType: 'pdf' | 'epub' | 'html', size: number) {
 if (!env.BETTER_AUTH_URL || !env.EXTRACTOR_TOKEN) throw new Error('Large file extraction unavailable');
 const url = new URL(`/api/internal/extractor-file/${encodeURIComponent(storyId)}`, env.BETTER_AUTH_URL);
 if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Invalid application URL');
 const token = await issueExtractorTicket(storyId, env.EXTRACTOR_TOKEN, Date.now() + 10 * 60 * 1000);
 return JSON.stringify({ url: url.toString(), token, size, fileType });
}

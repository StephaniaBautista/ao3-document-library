import { largeExtractionRequest } from './extractor-request';

type OcrEnv = Pick<Cloudflare.Env, 'EXTRACTOR_URL' | 'EXTRACTOR_TOKEN' | 'BETTER_AUTH_URL'>;

async function requestOcr(env: OcrEnv, path: string, contentType: string, body: BodyInit): Promise<string> {
 if (!env.EXTRACTOR_URL || !env.EXTRACTOR_TOKEN) throw new Error('OCR unavailable');
 const target = new URL(env.EXTRACTOR_URL);
 if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname))) throw new Error('Invalid extractor URL');
 const res = await fetch(new URL(path, target), { method: 'POST', headers: { Authorization: `Bearer ${env.EXTRACTOR_TOKEN}`, 'Content-Type': contentType }, body, redirect: 'manual', signal: AbortSignal.timeout(180000) });
 if (!res.ok) throw new Error('OCR unavailable');
 const result = await res.json() as { text?: unknown };
 if (typeof result.text !== 'string' || result.text.length > 100000) throw new Error('Invalid OCR response');
 return result.text;
}

export async function ocrImage(env: OcrEnv, image: Uint8Array) {
 return requestOcr(env, '/ocr-image', 'image/jpeg', image as unknown as BodyInit);
}

export async function ocrPdfPage(env: OcrEnv, bytes: ArrayBuffer, pageNumber = 1) {
 if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 100000 || bytes.byteLength > 24 * 1024 * 1024) throw new Error('Invalid PDF page');
 return requestOcr(env, `/ocr-pdf?page=${pageNumber}`, 'application/pdf', bytes);
}

export async function ocrLargePdfPage(env: OcrEnv, storyId: string, size: number, pageNumber = 1) {
 if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 100000) throw new Error('Invalid PDF page');
 const input = JSON.parse(await largeExtractionRequest(env, storyId, 'pdf', size)) as Record<string, unknown>;
 return requestOcr(env, '/ocr-pdf-from-url', 'application/json', JSON.stringify({ ...input, page: pageNumber }));
}

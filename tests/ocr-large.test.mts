import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ocrLargePdfPage, ocrPdfPage, ocrImage } from '../lib/catalog/xiaomi-ocr';

const env = { EXTRACTOR_URL: 'https://extractor.example', EXTRACTOR_TOKEN: 'synthetic-extractor-secret-123456789', BETTER_AUTH_URL: 'https://library.example' };
test('large PDF OCR sends a signed, page-specific request to the extractor', async () => {
 const original = globalThis.fetch;
 globalThis.fetch = async (input, init) => {
  assert.equal(String(input), 'https://extractor.example/ocr-pdf-from-url');
  assert.equal(init?.redirect, 'manual');
  const body = JSON.parse(String(init?.body));
  assert.equal(body.page, 3); assert.equal(body.fileType, 'pdf');
  assert.equal(body.url, 'https://library.example/api/internal/extractor-file/story-1');
  assert.equal(typeof body.token, 'string');
  return Response.json({ text: 'Texto reconocido' });
 };
 try { assert.equal(await ocrLargePdfPage(env, 'story-1', 51 * 1024 * 1024, 3), 'Texto reconocido'); }
 finally { globalThis.fetch = original; }
});

test('small PDF pages and images use the authenticated extractor and reject errors', async () => {
 const original = globalThis.fetch; const calls: string[] = [];
 globalThis.fetch = async (input, init) => {
  calls.push(String(input));
  assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${env.EXTRACTOR_TOKEN}`);
  return Response.json({ text: 'Texto reconocido' });
 };
 try {
  assert.equal(await ocrPdfPage(env, new TextEncoder().encode('%PDF-test').buffer, 7), 'Texto reconocido');
  assert.equal(await ocrImage(env, new Uint8Array([1,2,3])), 'Texto reconocido');
  assert.deepEqual(calls, ['https://extractor.example/ocr-pdf?page=7', 'https://extractor.example/ocr-image']);
  globalThis.fetch = async () => Response.json({ text: 42 });
  await assert.rejects(ocrImage(env, new Uint8Array([1])));
 } finally { globalThis.fetch = original; }
});

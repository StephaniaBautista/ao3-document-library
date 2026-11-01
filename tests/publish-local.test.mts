import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadCatalogFile } from '../lib/catalog/publish-local.ts';

test('publication sends the selected file and metadata to the existing shared-catalog endpoint', async () => {
 const original = globalThis.fetch;
 const file = new File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
 globalThis.fetch = async (input, init) => {
  assert.equal(input, '/api/catalog/stories');
  assert.equal(init?.method, 'PUT');
  const data = init?.body as FormData;
  assert.equal((data.get('file') as File).name, 'synthetic.pdf');
  assert.equal(data.get('title'), 'Historia sintética');
  return Response.json({ duplicate: false }, { status: 201 });
 };
 try {
  assert.deepEqual(await uploadCatalogFile(file, { title: 'Historia sintética' }), { duplicate: false });
  globalThis.fetch = async () => Response.json({ duplicate: true });
  assert.deepEqual(await uploadCatalogFile(file, {}), { duplicate: true });
 } finally { globalThis.fetch = original; }
});

test('publication reports rejected and uncertain outcomes without claiming success', async () => {
 const original = globalThis.fetch, file = new File(['%PDF-synthetic'], 'synthetic.pdf');
 try {
  globalThis.fetch = async () => new Response('', { status: 403 });
  await assert.rejects(() => uploadCatalogFile(file, {}), /session/);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(() => uploadCatalogFile(file, {}), /Could not confirm/);
  globalThis.fetch = async () => Response.json({});
  await assert.rejects(() => uploadCatalogFile(file, {}), /Could not confirm/);
 } finally { globalThis.fetch = original; }
});

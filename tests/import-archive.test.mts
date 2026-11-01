import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { prepareImport } from '../lib/catalog/import-archive.ts';

test('indexes mixed nested folders and reads supported documents one at a time', async () => {
 const zip = new JSZip();
 zip.file('one/story.pdf', '%PDF-test');
 zip.file('two/deeper/chapter.html', '<p>Hello</p>');
 zip.file('notes.txt', 'not a story');
 zip.file('__MACOSX/._story.pdf', 'metadata');
 const bytes = await zip.generateAsync({ type: 'uint8array' });
 const plan = await prepareImport([new File([bytes as BlobPart], 'library.zip')]);
 try {
  assert.deepEqual(plan.items.map(item => item.name), ['story.pdf', 'chapter.html']);
  assert.equal(await (await plan.items[1].read()).text(), '<p>Hello</p>');
 } finally { await plan.close(); }
});

test('reports oversized entries and continues with valid files', async () => {
 const zip = new JSZip();
 zip.file('big.html', new Uint8Array(51 * 1024 * 1024));
 zip.file('story.pdf', '%PDF-test');
 const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
 const plan = await prepareImport([new File([bytes as BlobPart], 'large.zip')]);
 try {
  assert.deepEqual(plan.items.map(item => item.name), ['story.pdf']);
  assert.match(plan.skipped[0], /50 MB/);
  assert.equal(await (await plan.items[0].read()).text(), '%PDF-test');
 } finally { await plan.close(); }
});

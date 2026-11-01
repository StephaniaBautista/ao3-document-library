import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadPrivateDriveFile, listPrivateDriveFolder, validReference } from '../lib/catalog/private-drive.ts';
import { driveFiles } from '../lib/catalog/private-drive-browser.ts';

test('private Drive lists supported files and shortcuts without forwarding the token on redirects', async () => {
 const original = globalThis.fetch, calls: string[] = [];
 globalThis.fetch = async (input, init) => {
  calls.push(String(input)); assert.equal(init?.redirect, 'manual');
  const headers = init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer private-token');
  if (String(input).includes('/files/root?')) return Response.json({ id: 'root', name: 'Root', mimeType: 'application/vnd.google-apps.folder' });
  return Response.json({ nextPageToken: 'next', files: [
   { id: 'one', name: 'Story.epub', mimeType: 'application/epub+zip', size: '4' },
   { id: 'shortcut', name: 'Folder', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'subfolder', targetMimeType: 'application/vnd.google-apps.folder', targetResourceKey: 'key' } },
   { id: '../bad', name: 'Bad', mimeType: 'application/pdf' },
   { id: 'doc', name: 'Other', mimeType: 'text/plain' },
  ] });
 };
 try {
  const result = await listPrivateDriveFolder('private-token', { id: 'root', resourceKey: null }, null);
  assert.deepEqual(result.entries.map(item => item.id), ['one', 'subfolder']);
  assert.equal(result.entries[1].resourceKey, 'key');
  assert.equal(result.nextPageToken, 'next');
  assert.equal(calls.length, 2);
  assert.equal(validReference({ id: "abc' or true", resourceKey: null }), false);
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } });
  await assert.rejects(() => listPrivateDriveFolder('private-token', { id: 'root', resourceKey: null }, null));
 } finally { globalThis.fetch = original; }
});

test('private Drive validates metadata and rejects oversized and truncated files', async () => {
 const original = globalThis.fetch;
 let size = '4', mimeType = 'application/pdf', content = 'test';
 globalThis.fetch = async input => String(input).includes('alt=media') ? new Response(content) : Response.json({ id: 'file', mimeType, size, trashed: false });
 try {
  const result = await downloadPrivateDriveFile('secret', { id: 'file', resourceKey: null });
  assert.equal(await new Response(result.stream).text(), 'test');
  size = String(50 * 1024 * 1024 + 1);
  await assert.rejects(() => downloadPrivateDriveFile('secret', { id: 'file', resourceKey: null }));
  size = '4'; mimeType = 'text/html';
  await assert.rejects(() => downloadPrivateDriveFile('secret', { id: 'file', resourceKey: null }));
  mimeType = 'application/pdf'; content = 'bad';
  const truncated = await downloadPrivateDriveFile('secret', { id: 'file', resourceKey: null });
  await assert.rejects(() => new Response(truncated.stream).text(), /Incomplete file/);
 } finally { globalThis.fetch = original; }
});

test('private import walks nested folders, handles pagination and avoids cycles', async () => {
 const original = globalThis.fetch, listings: string[] = [];
 const folder = 'application/vnd.google-apps.folder', epub = 'application/epub+zip', pdf = 'application/pdf';
 globalThis.fetch = async (input, init) => {
  const body = JSON.parse(String(init?.body));
  if (String(input).endsWith('/folders')) {
   const id = body.folder?.id || 'root'; listings.push(`${id}:${body.pageToken || ''}`);
   if (id === 'root' && !body.pageToken) return Response.json({ entries: [{ id: 'sub', resourceKey: 'key', name: 'Sub', mimeType: folder }], nextPageToken: 'next' });
   if (id === 'root') return Response.json({ entries: [{ id: 'one', resourceKey: null, name: 'First', mimeType: epub }], nextPageToken: null });
   return Response.json({ entries: [{ id: 'root', resourceKey: null, name: 'Cycle', mimeType: folder }, { id: 'two', resourceKey: null, name: 'Second.pdf', mimeType: pdf }], nextPageToken: null });
  }
  return new Response(body.id === 'one' ? 'epub' : 'pdf');
 };
 try {
  const files = [];
  for await (const file of driveFiles('https://drive.google.com/drive/folders/root')) files.push(file);
  assert.deepEqual(files.map(file => file?.name), ['First.epub', 'Second.pdf']);
  assert.deepEqual(listings, ['root:', 'root:next', 'sub:']);
 } finally { globalThis.fetch = original; }
});

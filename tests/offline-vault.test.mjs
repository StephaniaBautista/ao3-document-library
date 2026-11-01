import test from 'node:test';
import assert from 'node:assert/strict';
import { sealOffline, openOffline } from '../public/offline-vault.mjs';

const password = 'correct horse battery staple';
test('previously protected stories can be recovered only with their original password', async () => {
 const story = { title: 'Private title', pages: [{ text: 'Sensitive reading text' }] };
 const sealed = await sealOffline(story, password);
 assert.equal(new TextDecoder().decode(sealed.ciphertext).includes(story.title), false);
 assert.deepEqual(await openOffline(sealed, password), story);
 await assert.rejects(openOffline(sealed, 'incorrect password'), /Incorrect offline password/);
});

test('previously protected stories reject tampering and invalid passwords', async () => {
 const first = await sealOffline({ text: 'A saved page' }, password), second = await sealOffline({ text: 'A saved page' }, password);
 assert.notDeepEqual(first.salt, second.salt); assert.notDeepEqual(first.iv, second.iv);
 const damaged = structuredClone(first); new Uint8Array(damaged.ciphertext)[0] ^= 1;
 await assert.rejects(openOffline(damaged, password), /damaged data/);
 await assert.rejects(sealOffline({}, 'short'), /at least 12/);
});

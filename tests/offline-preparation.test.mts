import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOfflinePreparation, saveOfflinePreparation } from '../lib/catalog/offline-preparation.ts';
import { sealOffline } from '../public/offline-vault.mjs';

test('new interrupted preparation resumes without a password and old encrypted data stays intact', async () => {
 const entries = new Map<string, unknown>();
 const previous = globalThis.indexedDB;
 const db = {
  close() {},
  transaction() {
   const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: () => object } = { objectStore() {
    return {
     get(id: string) { const req: { result?: unknown } = {}; queueMicrotask(() => { req.result = structuredClone(entries.get(id)); tx.oncomplete?.(); }); return req; },
     put(value: { id: string }) { const req: { result?: unknown } = {}; queueMicrotask(() => { entries.set(value.id, structuredClone(value)); req.result = value.id; tx.oncomplete?.(); }); return req; },
    };
   } };
   return tx;
  },
 };
 Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() { const request: { result?: unknown; onsuccess?: () => void } = {}; queueMicrotask(() => { request.result = db; request.onsuccess?.(); }); return request; } } });
 try {
  const job = { id: 'one:passwordless', updatedAt: Date.now(), fingerprint: 'digest', pages: [{ text: 'unfinished page' }], total: 1, bytes: 42 };
  const oldJob = { ...job, id: 'one' };
  const sealed = await sealOffline(oldJob, 'long-offline-password');
  entries.set('one', { id: 'one', sealed });
  await saveOfflinePreparation(job);
  assert.deepEqual((await loadOfflinePreparation<typeof job.pages[0]>(job.id))?.pages, job.pages);
  assert.deepEqual(entries.get('one'), { id: 'one', sealed });
  await assert.rejects(loadOfflinePreparation('one'), /encrypted/);
  assert.deepEqual(entries.get('one'), { id: 'one', sealed });
 } finally { Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: previous }); }
});

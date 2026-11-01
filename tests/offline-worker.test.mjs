import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('offline navigation serves a usable page after the host redirects its HTML URL', async () => {
 const handlers = new Map(), entries = new Map();
 let online = true;
 const cache = {
  async put(key, response) { entries.set(key, response); },
  async addAll(keys) { for (const key of keys) entries.set(key, new Response(key)); },
 };
 const caches = { async open() { return cache; }, async match(key) { if (typeof key !== 'string' && key.headers?.Origin) return undefined; return entries.get(typeof key === 'string' ? key : new URL(key.url).pathname); } };
 const self = { location: { origin: 'https://biblioteca.test' }, addEventListener(type, handler) { handlers.set(type, handler); }, async skipWaiting() {} };
 const fetch = async () => {
  if (!online) throw new TypeError('Network unavailable');
  const response = new Response('<h1>Historias guardadas</h1>', { headers: { 'content-type': 'text/html', 'content-length': '1', 'content-encoding': 'gzip' } });
  Object.defineProperty(response, 'redirected', { value: true });
  return response;
 };
 const source = await readFile(new URL('../public/offline-worker.js', import.meta.url), 'utf8');
 vm.runInNewContext(source, { self, caches, fetch, Headers, Response, URL });
 let installed;
 handlers.get('install')({ waitUntil(promise) { installed = promise; } });
 await installed;
 online = false;
 let result;
 handlers.get('fetch')({ request: { method: 'GET', mode: 'navigate', url: 'https://biblioteca.test/offline' }, respondWith(promise) { result = promise; } });
 const response = await result;
 assert.equal(response.redirected, false);
 assert.equal(response.headers.get('content-encoding'), null);
 assert.equal(response.headers.get('content-length'), null);
 assert.match(await response.text(), /Historias guardadas/);
 // Module requests may carry an Origin header that was absent when cached.
 // The worker must still use the cached shell instead of the network.
 handlers.get('fetch')({ request: { method: 'GET', mode: 'cors', url: 'https://biblioteca.test/offline.js', headers: { Origin: 'https://biblioteca.test' } }, respondWith(promise) { result = promise; } });
 assert.equal(await (await result).text(), '/offline.js');
 handlers.get('fetch')({ request: { method: 'GET', mode: 'cors', url: 'https://biblioteca.test/offline-export.js', headers: { Origin: 'https://biblioteca.test' } }, respondWith(promise) { result = promise; } });
 assert.equal(await (await result).text(), '/offline-export.js');
});

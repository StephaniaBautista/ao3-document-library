const CACHE = 'biblioteca-offline-v14';
const SHELL = ['/offline.html', '/offline.css', '/offline-appearance.js', '/offline-topbar.js', '/offline.js', '/offline-vault.mjs', '/offline-export.js', ...['NotoSans-Regular', 'NotoSans-Bold', 'NotoSans-Italic', 'NotoSans-BoldItalic', 'NotoSerif-Regular', 'NotoSerif-Bold', 'NotoSerif-Italic', 'NotoSerif-BoldItalic'].map(name => `/reader-fonts/${name}.ttf`)];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Some hosts redirect .html URLs. A redirected response cannot be used as
    // the offline navigation response, so store a fresh, non-redirected copy.
    const page = await fetch('/offline.html');
    if (!page.ok) throw new Error('Could not cache offline page');
    const headers = new Headers(page.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    await cache.put('/offline.html', new Response(await page.arrayBuffer(), { status: 200, headers }));
    await cache.addAll(SHELL.slice(1));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('biblioteca-offline-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && (url.pathname === '/offline' || url.pathname === '/offline/')) {
    event.respondWith(caches.match('/offline.html').then(cached => cached || fetch(request)));
  } else if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/offline.html')) {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
  } else if (SHELL.includes(url.pathname)) {
    // Module requests can include Origin, while installation requests do not.
    event.respondWith(caches.match(url.pathname).then(cached => cached || fetch(request)));
  }
});

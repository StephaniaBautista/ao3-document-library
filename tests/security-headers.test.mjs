import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { secureResponse, securityHeaders } from '../lib/security-headers.mjs';

test('security headers cover normal responses while retaining the response body and status', async () => {
 const res = secureResponse(new Response('ok', { status: 201 }), 'https://app.example.test/');
 assert.equal(res.status, 201); assert.equal(await res.text(), 'ok');
 assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
 assert.equal(res.headers.get('x-frame-options'), 'DENY');
 assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
 assert.match(res.headers.get('strict-transport-security'), /max-age=/);
});

test('a route-specific sandbox is preserved and HSTS is not added over HTTP', () => {
 const res = secureResponse(new Response(null, { headers: { 'Content-Security-Policy': "default-src 'none'; sandbox" } }), 'http://localhost/');
 assert.equal(res.headers.get('content-security-policy'), "default-src 'none'; sandbox");
 assert.equal(res.headers.get('strict-transport-security'), null);
});

test('Cloudflare static assets receive the same baseline policy as dynamic responses', async () => {
 const file = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
 for (const [key, value] of Object.entries(securityHeaders)) assert.ok(file.includes(`  ${key}: ${value}\n`), `${key} differs for static assets`);
});

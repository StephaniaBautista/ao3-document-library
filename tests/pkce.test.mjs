import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeChallenge, newCodeVerifier } from '../lib/catalog/pkce.mjs';
test('PKCE uses the RFC 7636 S256 transformation and unpredictable URL-safe verifiers', async () => {
 assert.equal(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
 const a = newCodeVerifier(), b = newCodeVerifier();
 assert.match(a, /^[A-Za-z0-9_-]{43}$/);
 assert.notEqual(a, b);
});

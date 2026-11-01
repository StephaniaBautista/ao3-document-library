import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestIdentityRedaction } from '../lib/catalog/identity-redaction.ts';

test('account deletion requests redaction for the matching identity and confirms it started', async () => {
 const original = globalThis.fetch, requests = [];
 globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), method: init.method || 'GET' });
  assert.equal(init.redirect, 'manual');
  return Response.json(requests.length === 1
   ? { id: 'vs_abc', type: 'document', client_reference_id: 'user', status: 'verified', redaction: null }
   : { id: 'vs_abc', redaction: { status: 'processing' } });
 };
 try {
  await requestIdentityRedaction('synthetic', 'vs_abc', 'user');
  assert.deepEqual(requests.map(row => row.method), ['GET', 'POST']);
  assert.equal(requests[1].url, 'https://api.stripe.com/v1/identity/verification_sessions/vs_abc/redact');
 } finally { globalThis.fetch = original; }
});

test('already redacted or redacting sessions do not need another request', async () => {
 const original = globalThis.fetch; let calls = 0;
 globalThis.fetch = async () => { calls++; return Response.json({ id: 'vs_abc', redaction: { status: calls === 1 ? 'processing' : 'redacted' } }); };
 try {
  await requestIdentityRedaction('synthetic', 'vs_abc', 'user');
  await requestIdentityRedaction('synthetic', 'vs_abc', 'user');
  assert.equal(calls, 2);
 } finally { globalThis.fetch = original; }
});

test('refuses to claim deletion when the session belongs to someone else or Stripe did not confirm redaction', async () => {
 const original = globalThis.fetch;
 try {
  globalThis.fetch = async () => Response.json({ id: 'vs_abc', type: 'document', client_reference_id: 'other', redaction: null });
  await assert.rejects(requestIdentityRedaction('synthetic', 'vs_abc', 'user'));
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json(calls === 1 ? { id: 'vs_abc', type: 'document', client_reference_id: 'user', status: 'requires_input', redaction: null } : { id: 'vs_abc', redaction: null }); };
  await assert.rejects(requestIdentityRedaction('synthetic', 'vs_abc', 'user'));
  assert.equal(calls, 2);
 } finally { globalThis.fetch = original; }
});

test('canceled and processing sessions retain their reference instead of requesting unsupported redaction', async () => {
 const original = globalThis.fetch; let calls = 0;
 try {
  for (const status of ['canceled', 'processing']) {
   globalThis.fetch = async () => { calls++; return Response.json({ id:'vs_abc', type:'document', client_reference_id:'user', status, redaction:null }); };
   await assert.rejects(requestIdentityRedaction('synthetic','vs_abc','user'));
  }
  assert.equal(calls,2);
 } finally { globalThis.fetch = original; }
});

test('a provider error or invalid session keeps account deletion retryable', async () => {
 const original = globalThis.fetch; let calls = 0;
 globalThis.fetch = async () => { calls++; return new Response(null, { status: 409 }); };
 try {
  await assert.rejects(requestIdentityRedaction('synthetic', 'vs_abc', 'user'));
  await assert.rejects(requestIdentityRedaction('synthetic', 'vs_../bad', 'user'));
  assert.equal(calls, 1);
 } finally { globalThis.fetch = original; }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendMail, isMailConfigured } from '../lib/email-transport.ts';

const message = { to: 'reader@example.test', subject: 'Test', text: 'Plain', html: '<p>HTML</p>' };
const env = { BREVO_API_KEY: 'test-brevo', BREVO_FROM_EMAIL: 'sender@example.test', BREVO_FROM_NAME: 'Biblioteca', POSTMARK_SERVER_TOKEN: 'old', POSTMARK_FROM_EMAIL: 'old@example.test' };

test('Brevo sends both versions of account and reminder emails to the requested recipient', async () => {
 const original = globalThis.fetch; let seen = 0;
 globalThis.fetch = async (url, init) => {
  seen++; assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(init.headers['api-key'], 'test-brevo'); assert.equal(init.redirect, 'manual');
  const body = JSON.parse(init.body);
  assert.deepEqual(body.sender, { email: 'sender@example.test', name: 'Biblioteca' });
  assert.deepEqual(body.to, [{ email: 'reader@example.test' }]);
  assert.equal(body.textContent, 'Plain'); assert.equal(body.htmlContent, '<p>HTML</p>');
  return Response.json({ messageId: '<sample@brevo.test>' }, { status: 201 });
 };
 try { assert.equal(await sendMail(env, message), 'accepted'); assert.equal(seen, 1); } finally { globalThis.fetch = original; }
});

test('partial Brevo setup cannot silently fall back to Postmark', async () => {
 const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error('must not send'); };
 try { const partial = { ...env, BREVO_FROM_EMAIL: '' }; assert.equal(isMailConfigured(partial), false); assert.equal(await sendMail(partial, message), 'failed'); } finally { globalThis.fetch = original; }
});

test('quota refusal remains distinguishable from a timeout or ambiguous response', async () => {
 const original = globalThis.fetch;
 try {
  globalThis.fetch = async () => new Response(null, { status: 429 }); assert.equal(await sendMail(env, message), 'rate_limited');
  globalThis.fetch = async () => { throw new Error('timeout'); }; assert.equal(await sendMail(env, message), 'unknown');
  globalThis.fetch = async () => Response.json({}, { status: 201 }); assert.equal(await sendMail(env, message), 'unknown');
  globalThis.fetch = async () => new Response(null, { status: 403 }); assert.equal(await sendMail(env, message), 'failed');
 } finally { globalThis.fetch = original; }
});

test('attachments use the expected Brevo and Postmark payloads without changing other messages', async () => {
 const original = globalThis.fetch;
 const attachment = { name: 'prueba.png', content: 'AQID', contentType: 'image/png' };
 try {
  globalThis.fetch = async (_url, init) => { const body = JSON.parse(init.body); assert.deepEqual(body.attachment, [{ name: 'prueba.png', content: 'AQID' }]); return Response.json({ messageId: 'id' }); };
  assert.equal(await sendMail(env, { ...message, attachments: [attachment] }), 'accepted');
  globalThis.fetch = async (_url, init) => { const body = JSON.parse(init.body); assert.deepEqual(body.Attachments, [{ Name: 'prueba.png', Content: 'AQID', ContentType: 'image/png' }]); return Response.json({ ErrorCode: 0, MessageID: 'id' }); };
  assert.equal(await sendMail({ POSTMARK_SERVER_TOKEN: 'token', POSTMARK_FROM_EMAIL: 'sender@example.test' }, { ...message, attachments: [attachment] }), 'accepted');
 } finally { globalThis.fetch = original; }
});

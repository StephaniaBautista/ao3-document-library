import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { choosePartSize, partLength, signUploadTicket, verifyUploadTicket, hashObject } from '../lib/catalog/multipart.ts';

const MiB = 1024 * 1024;
const secret = 'synthetic-test-secret-only-123456789';
const ticket = { version: 1, id: '00000000-0000-4000-8000-000000000001', userId: 'user-1', uploadId: 'temporary-upload', filename: 'story.pdf', fileType: 'pdf', folderId: null, size: 25 * MiB + 1, partSize: 8 * MiB, expiresAt: 2000 };

test('tickets bind the upload to its owner and expire without accepting tampering', async () => {
 const token = await signUploadTicket(ticket, secret);
 assert.deepEqual(await verifyUploadTicket(token, secret, 'user-1', 1000), ticket);
 assert.equal(await verifyUploadTicket(token, secret, 'user-2', 1000), null);
 assert.equal(await verifyUploadTicket(token, secret, 'user-1', 2000), null);
 const [payload, signature] = token.split('.');
 assert.equal(await verifyUploadTicket(`${payload.slice(0, -1)}A.${signature}`, secret, 'user-1', 1000), null);
});

test('part sizes remain bounded and the last part has the exact remaining length', () => {
 assert.equal(choosePartSize(51 * MiB), 8 * MiB);
 assert.equal(choosePartSize(10_001 * 8 * MiB), 9 * MiB);
 assert.equal(partLength(ticket, 1), 8 * MiB);
 assert.equal(partLength(ticket, 4), MiB + 1);
 assert.equal(partLength(ticket, 5), null);
 assert.equal(choosePartSize(64 * MiB * 10000 + 1), null);
});

test('streamed SHA-256 matches existing file hashes and rejects truncated objects', async () => {
 const chunks = [new TextEncoder().encode('%PDF-'), new Uint8Array([0, 1, 2, 255])];
 const stream = () => new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } });
 const expected = createHash('sha256').update(chunks[0]).update(chunks[1]).digest('hex');
 assert.equal(await hashObject(stream(), 9), expected);
 await assert.rejects(hashObject(stream(), 10));
 await assert.rejects(hashObject(stream(), 8));
});

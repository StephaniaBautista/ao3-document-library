import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseByteRange } from '../lib/catalog/byte-range.mjs';

test('supports bounded, open and suffix ranges while clamping to the object', () => {
 assert.deepEqual(parseByteRange('bytes=10-19', 100), { kind: 'range', start: 10, end: 19, length: 10 });
 assert.deepEqual(parseByteRange('bytes=90-', 100), { kind: 'range', start: 90, end: 99, length: 10 });
 assert.deepEqual(parseByteRange('bytes=-15', 100), { kind: 'range', start: 85, end: 99, length: 15 });
 assert.deepEqual(parseByteRange('bytes=95-1000', 100), { kind: 'range', start: 95, end: 99, length: 5 });
 assert.deepEqual(parseByteRange('bytes=-1000', 100), { kind: 'range', start: 0, end: 99, length: 100 });
});

test('rejects unsatisfiable ranges and ignores unsupported or malformed ones', () => {
 for (const range of ['bytes=100-', 'bytes=-0']) assert.deepEqual(parseByteRange(range, 100), { kind: 'unsatisfiable' });
 assert.deepEqual(parseByteRange('bytes=0-', 0), { kind: 'unsatisfiable' });
 for (const range of ['bytes=20-10', 'bytes=0-1,3-4', 'bytes=-', 'bytes=9007199254740992-', 'items=0-1']) assert.deepEqual(parseByteRange(range, 100), { kind: 'full' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredProgressWriter, trackClosingProgress, waitForClosingProgress } from '../lib/catalog/deferred-progress.mjs';

test('closing the reader flushes the last position and keeps writes in order', async () => {
 const sent = []; let release;
 const first = new Promise(resolve => { release = resolve; });
 const writer = createDeferredProgressWriter(async value => { sent.push(value); if (value === 'pdf:2') await first; }, () => assert.fail('unexpected error'), 60_000);
 writer.schedule('pdf:2'); const initial = writer.flush();
 await Promise.resolve();
 writer.schedule('pdf:3'); writer.schedule('pdf:4'); const closing = writer.flush();
 assert.deepEqual(sent, ['pdf:2']);
 release(); await initial; await closing;
 assert.deepEqual(sent, ['pdf:2', 'pdf:4']);
 await writer.flush(); assert.deepEqual(sent, ['pdf:2', 'pdf:4']);
});

test('a failed save is reported and a later position can still be saved', async () => {
 const sent = [], errors = [];
 const writer = createDeferredProgressWriter(async value => { sent.push(value); if (value === 'pdf:2') throw new Error('offline'); }, (error, value) => errors.push([error.message, value]), 60_000);
 writer.schedule('pdf:2'); await writer.flush();
 writer.schedule('pdf:3'); await writer.flush();
 assert.deepEqual(sent, ['pdf:2', 'pdf:3']);
 assert.deepEqual(errors, [['offline', 'pdf:2']]);
});

test('reopening a story waits for its closing save without blocking other stories', async () => {
 let release, reopened = false;
 const completion = new Promise(resolve => { release = resolve; });
 trackClosingProgress('story-1', completion);
 const waiting = waitForClosingProgress('story-1').then(() => { reopened = true; });
 await waitForClosingProgress('story-2');
 assert.equal(reopened, false);
 release(); await waiting;
 assert.equal(reopened, true);
});

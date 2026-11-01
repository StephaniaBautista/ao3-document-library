import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueTranslationProgress, waitForTranslationProgress } from '../lib/catalog/translation-progress.mjs';

test('reopening waits for all saves of the same job while other translations remain available', async () => {
 const saved = []; let release;
 const slow = new Promise(resolve => { release = resolve; });
 const first = queueTranslationProgress('job-a', async () => { saved.push(10); await slow; });
 const second = queueTranslationProgress('job-a', async () => { saved.push(11); });
 let reopened = false;
 const wait = waitForTranslationProgress('job-a').then(() => { reopened = true; });
 await waitForTranslationProgress('job-b');
 assert.equal(reopened, false); assert.deepEqual(saved, [10]);
 release(); await Promise.all([first, second, wait]);
 assert.deepEqual(saved, [10, 11]); assert.equal(reopened, true);
});

test('a failed write is surfaced and does not block a later save', async () => {
 const failed = queueTranslationProgress('job-failure', async () => { throw new Error('offline'); });
 await assert.rejects(failed, /offline/);
 let saved = false;
 await queueTranslationProgress('job-failure', async () => { saved = true; });
 await waitForTranslationProgress('job-failure');
 assert.equal(saved, true);
});

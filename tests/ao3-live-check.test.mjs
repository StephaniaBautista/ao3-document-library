import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAo3LiveCheck } from '../lib/catalog/ao3-live-check.mjs';

test('checks AO3 and reuses a recent observation before checking again', async () => {
 let now = 1_000_000, calls = 0;
 const check = createAo3LiveCheck(async url => {
  calls++;
  assert.equal(url, 'https://archiveofourown.org/');
  return new Response(null, { status: calls === 1 ? 200 : 503 });
 }, () => now);
 assert.deepEqual(await check(), { state: 'up', lastCheckedAt: now, source: 'live' });
 now += 59_999;
 assert.equal((await check()).state, 'up');
 assert.equal(calls, 1);
 now++;
 assert.equal((await check()).state, 'down');
 assert.equal(calls, 2);
});

test('ambiguous responses and network errors remain uncertain', async () => {
 for (const fetcher of [async () => new Response(null, { status: 403 }), async () => { throw new Error('offline'); }]) {
  assert.equal((await createAo3LiveCheck(fetcher)()).state, 'unknown');
 }
});

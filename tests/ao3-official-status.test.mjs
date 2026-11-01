import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialStatusCheck, parseOfficialStatus } from '../lib/catalog/ao3-official-status.mjs';

const id = 'w84xs5kg4lp6';
const summary = status => ({ components: [{ id, name: 'Archive of Our Own', status }], incidents: [], scheduled_maintenances: [] });

test('reports official AO3 maintenance and its latest update', () => {
 const data = summary('major_outage');
 data.incidents.push({ name: 'AO3 Down for Maintenance', components: [{ id }], updated_at: '2026-10-30T00:00:00Z', incident_updates: [{ body: 'An update' }] });
 assert.deepEqual(parseOfficialStatus(data, 42), { state: 'maintenance', lastCheckedAt: 42, source: 'official', incident: { name: 'AO3 Down for Maintenance', update: 'An update', updatedAt: '2026-10-30T00:00:00Z' } });
});

test('only includes AO3 incidents and maps degraded and unknown data safely', () => {
 const data = summary('operational');
 data.incidents.push({ name: 'Fanlore Maintenance', components: [{ id: 'other' }] });
 assert.equal(parseOfficialStatus(data).state, 'up');
 data.components[0].status = 'partial_outage';
 assert.equal(parseOfficialStatus(data).state, 'degraded');
 data.components[0].status = 'unexpected';
 assert.throws(() => parseOfficialStatus(data));
});

test('caches successful official checks and does not cache errors', async () => {
 let now = 1_000, calls = 0;
 const check = createOfficialStatusCheck(async (url, options) => { calls++; assert.equal(url, 'https://otwstatus.statuspage.io/api/v2/summary.json'); assert.equal(options.redirect, 'manual'); return new Response(JSON.stringify(summary('operational')), { status: 200 }); }, () => now);
 await check(); await check(); assert.equal(calls, 1);
 now += 60_000; await check(); assert.equal(calls, 2);
 let failures = 0;
 const failing = createOfficialStatusCheck(async () => { failures++; return new Response(null, { status: 503 }); });
 await assert.rejects(failing); await assert.rejects(failing); assert.equal(failures, 2);
});

test('does not follow redirects from the official status endpoint', async () => {
 const check = createOfficialStatusCheck(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/' } }));
 await assert.rejects(check);
});

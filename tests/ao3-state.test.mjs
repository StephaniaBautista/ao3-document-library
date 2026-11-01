import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextAo3State, classifyAo3Response, visibleAo3State, hasConfirmedRecovery } from '../lib/catalog/ao3-state.mjs';

test('requires repeated failure and recovery before reporting recovery', () => {
 let state = nextAo3State(null, 'success', 1);
 state = nextAo3State(state, 'success', 2);
 assert.equal(state.state, 'up');
 state = nextAo3State(state, 'failure', 3);
 assert.equal(state.state, 'up');
 state = nextAo3State(state, 'failure', 4);
 assert.equal(state.state, 'down');
 state = nextAo3State(state, 'success', 5);
 assert.equal(state.state, 'down');
 state = nextAo3State(state, 'success', 6);
 assert.equal(state.state, 'up');
 assert.equal(state.recoveredAt, 6);
});
test('ambiguous responses do not falsely declare a failure or recovery', () => {
 assert.equal(classifyAo3Response(403), 'uncertain');
 assert.equal(classifyAo3Response(503), 'failure');
 let state = nextAo3State({ state: 'down', consecutiveSuccesses: 1, consecutiveFailures: 0, recoveredAt: null }, 'uncertain', 2);
 state = nextAo3State(state, 'success', 3);
 assert.equal(state.state, 'down');
 assert.equal(state.recoveredAt, null);
});

test('the displayed status and recovery notifications require fresh, consistent observations', () => {
 const now = 1_000_000;
 const up = { state:'up', lastObservation:'success', lastCheckedAt:now, consecutiveSuccesses:2, consecutiveFailures:0, recoveredAt:123 };
 assert.equal(visibleAo3State(up, now), 'up'); assert.equal(hasConfirmedRecovery(up), true);
 for (const changes of [{ lastObservation:'uncertain', consecutiveSuccesses:0 }, { lastObservation:'failure', consecutiveSuccesses:0, consecutiveFailures:1 }, { lastObservation:'success', consecutiveSuccesses:1 }]) {
  const candidate = { ...up, ...changes };
  assert.equal(visibleAo3State(candidate, now), 'unknown'); assert.equal(hasConfirmedRecovery(candidate), false);
 }
 assert.equal(visibleAo3State(up, now + 180_001), 'unknown');
 assert.equal(visibleAo3State({ ...up, lastCheckedAt:now + 61_000 }, now), 'unknown');
 const down = { ...up, state:'down', lastObservation:'failure', consecutiveSuccesses:0, consecutiveFailures:2 };
 assert.equal(visibleAo3State(down, now), 'down');
 assert.equal(visibleAo3State({ ...down, lastObservation:'success', consecutiveSuccesses:1, consecutiveFailures:0 }, now), 'unknown');
});

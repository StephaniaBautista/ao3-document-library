export function nextAo3State(previous, observation, now) {
 const old = previous || { state: 'unknown', consecutiveSuccesses: 0, consecutiveFailures: 0, recoveredAt: null };
 let { state } = old;
 const consecutiveSuccesses = observation === 'success' ? old.consecutiveSuccesses + 1 : 0;
 const consecutiveFailures = observation === 'failure' ? old.consecutiveFailures + 1 : 0;
 let recoveredAt = old.recoveredAt;
 if (consecutiveFailures >= 2) state = 'down';
 if (consecutiveSuccesses >= 2) {
  if (old.state === 'down') recoveredAt = now;
  state = 'up';
 }
 return { state, consecutiveSuccesses, consecutiveFailures, recoveredAt, lastCheckedAt: now, lastObservation: observation };
}
export function classifyAo3Response(status) {
 if (status >= 200 && status < 300) return 'success';
 if (status >= 500 && status < 600) return 'failure';
 return 'uncertain';
}

/** Do not present a previous confirmation as current after a contradictory check. */
export function visibleAo3State(row, now = Date.now()) {
 if (!row || !row.lastCheckedAt || now - row.lastCheckedAt > 3 * 60_000 || row.lastCheckedAt > now + 60_000) return 'unknown';
 if (row.state === 'up' && row.lastObservation === 'success' && row.consecutiveSuccesses >= 2) return 'up';
 if (row.state === 'down' && row.lastObservation === 'failure' && row.consecutiveFailures >= 2) return 'down';
 return 'unknown';
}

export function hasConfirmedRecovery(row) {
 return row.state === 'up' && row.lastObservation === 'success' && row.consecutiveSuccesses >= 2 && typeof row.recoveredAt === 'number' && row.recoveredAt > 0;
}

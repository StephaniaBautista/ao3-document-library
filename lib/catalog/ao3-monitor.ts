import { classifyAo3Response, type Ao3State } from './ao3-state.mjs';

export async function checkAo3(db: D1Database) {
 let observation: 'success' | 'failure' | 'uncertain' = 'uncertain';
 try {
  const res = await fetch('https://archiveofourown.org/', { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'FicLibraryStatusMonitor/1.0' } });
  observation = classifyAo3Response(res.status);
 } catch { /* Network failure is not proof that AO3 is down. */ }
 // Apply the observation in one statement so overlapping scheduled runs cannot
 // both compute their transitions from the same stale snapshot.
 const next = await db.prepare(`INSERT INTO ao3_status (id, state, consecutive_successes, consecutive_failures, last_checked_at, recovered_at, last_observation)
  VALUES ('ao3', 'unknown', CASE WHEN ? = 'success' THEN 1 ELSE 0 END, CASE WHEN ? = 'failure' THEN 1 ELSE 0 END, ?, NULL, ?)
  ON CONFLICT(id) DO UPDATE SET
   state = CASE
    WHEN excluded.last_observation = 'failure' AND ao3_status.consecutive_failures >= 1 THEN 'down'
    WHEN excluded.last_observation = 'success' AND ao3_status.consecutive_successes >= 1 THEN 'up'
    ELSE ao3_status.state END,
   recovered_at = CASE WHEN excluded.last_observation = 'success' AND ao3_status.consecutive_successes >= 1 AND ao3_status.state = 'down' THEN excluded.last_checked_at ELSE ao3_status.recovered_at END,
   consecutive_successes = CASE WHEN excluded.last_observation = 'success' THEN ao3_status.consecutive_successes + 1 ELSE 0 END,
   consecutive_failures = CASE WHEN excluded.last_observation = 'failure' THEN ao3_status.consecutive_failures + 1 ELSE 0 END,
   last_checked_at = excluded.last_checked_at, last_observation = excluded.last_observation
  RETURNING state, consecutive_successes AS consecutiveSuccesses, consecutive_failures AS consecutiveFailures, recovered_at AS recoveredAt, last_checked_at AS lastCheckedAt, last_observation AS lastObservation`)
  .bind(observation, observation, Date.now(), observation).first<Ao3State>();
 if (!next) throw new Error('Could not store AO3 status');
 return next;
}

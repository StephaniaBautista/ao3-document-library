import { classifyAo3Response } from './ao3-state.mjs';

// This is a single observation, separate from the scheduled recovery monitor.
// The small per-isolate cache limits repeat requests; it is not a distributed lock.
export function createAo3LiveCheck(fetcher = fetch, now = Date.now) {
 let cached = null;
 return async function check() {
  if (cached && now() - cached.lastCheckedAt < 60_000 && now() >= cached.lastCheckedAt) return cached;
  let observation = 'uncertain';
  try {
   const response = await fetcher('https://archiveofourown.org/', { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'FicLibraryStatusMonitor/1.0' } });
   observation = classifyAo3Response(response.status);
   await response.body?.cancel();
  } catch { /* A network error cannot establish AO3's status. */ }
  const result = { state: observation === 'success' ? 'up' : observation === 'failure' ? 'down' : 'unknown', lastCheckedAt: now(), source: 'live' };
  cached = result;
  return result;
 };
}

export const checkAo3Live = createAo3LiveCheck();

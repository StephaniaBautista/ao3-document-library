export type Ao3State = { state: 'unknown' | 'up' | 'down'; consecutiveSuccesses: number; consecutiveFailures: number; recoveredAt: number | null; lastCheckedAt?: number; lastObservation?: 'success' | 'failure' | 'uncertain' };
export function nextAo3State(previous: Ao3State | null, observation: 'success' | 'failure' | 'uncertain', now: number): Ao3State;
export function classifyAo3Response(status: number): 'success' | 'failure' | 'uncertain';
export function visibleAo3State(row: { state: string; lastCheckedAt: number | null; lastObservation: string | null; consecutiveSuccesses: number; consecutiveFailures: number } | null, now?: number): 'unknown' | 'up' | 'down';
export function hasConfirmedRecovery(row: Ao3State): boolean;

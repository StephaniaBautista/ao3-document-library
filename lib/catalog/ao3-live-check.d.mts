export type LiveAo3Status = { state: 'up' | 'down' | 'unknown'; lastCheckedAt: number; source: 'live' };
export function createAo3LiveCheck(fetcher?: typeof fetch, now?: () => number): () => Promise<LiveAo3Status>;
export const checkAo3Live: () => Promise<LiveAo3Status>;

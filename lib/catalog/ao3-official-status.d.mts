export type OfficialAo3Status = { state: 'up' | 'down' | 'degraded' | 'maintenance'; lastCheckedAt: number; source: 'official'; incident: { name: string; update: string; updatedAt: string | null } | null };
export function parseOfficialStatus(data: unknown, now?: number): OfficialAo3Status;
export function createOfficialStatusCheck(fetcher?: typeof fetch, now?: () => number): () => Promise<OfficialAo3Status>;
export const checkOfficialStatus: () => Promise<OfficialAo3Status>;

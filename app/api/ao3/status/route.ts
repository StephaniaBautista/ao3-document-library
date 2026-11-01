import { catalogAccess } from '@/lib/catalog/access';
import { visibleAo3State } from '@/lib/catalog/ao3-state.mjs';
import { checkAo3Live } from '@/lib/catalog/ao3-live-check.mjs';
import { checkOfficialStatus } from '@/lib/catalog/ao3-official-status.mjs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 try {
  return Response.json(await checkOfficialStatus(), { headers: { 'Cache-Control': 'no-store' } });
 } catch { /* Fall back to our independent availability checks. */ }
 const row = await access.context.db.prepare('SELECT state, last_checked_at AS lastCheckedAt, last_observation AS lastObservation, consecutive_successes AS consecutiveSuccesses, consecutive_failures AS consecutiveFailures FROM ao3_status WHERE id = ?').bind('ao3').first<{ state: string; lastCheckedAt: number | null; lastObservation: string | null; consecutiveSuccesses: number; consecutiveFailures: number }>();
 const now = Date.now();
 const recent = row?.lastCheckedAt && now - row.lastCheckedAt <= 3 * 60_000 && row.lastCheckedAt <= now + 60_000;
 const status = recent
  ? { state: visibleAo3State(row, now), lastCheckedAt: row!.lastCheckedAt, source: 'monitor' }
  : await checkAo3Live();
 return Response.json(status, { headers: { 'Cache-Control': 'no-store' } });
}

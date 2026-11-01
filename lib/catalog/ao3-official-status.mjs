const COMPONENT_ID = 'w84xs5kg4lp6';

export function parseOfficialStatus(data, now = Date.now()) {
 const component = data?.components?.find(item => item.id === COMPONENT_ID && item.name === 'Archive of Our Own');
 const allowed = ['operational', 'degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance'];
 if (!component || !allowed.includes(component.status) || !Array.isArray(data.incidents) || !Array.isArray(data.scheduled_maintenances)) throw new Error('Invalid status response');
 const relevant = [...data.incidents, ...data.scheduled_maintenances.filter(item => item.status === 'in_progress')]
  .filter(item => Array.isArray(item.components) && item.components.some(part => part.id === COMPONENT_ID));
 const incident = relevant[0];
 const maintenance = component.status === 'under_maintenance' || relevant.some(item => /maintenance/i.test(item.name || ''));
 const state = maintenance ? 'maintenance' : component.status === 'major_outage' ? 'down' : component.status !== 'operational' || relevant.length ? 'degraded' : 'up';
 return {
  state, lastCheckedAt: now, source: 'official',
  incident: incident ? { name: typeof incident.name === 'string' ? incident.name.slice(0, 300) : '', update: typeof incident.incident_updates?.[0]?.body === 'string' ? incident.incident_updates[0].body.slice(0, 8000) : '', updatedAt: incident.updated_at || null } : null,
 };
}

export function createOfficialStatusCheck(fetcher = fetch, now = Date.now) {
 let cached = null;
 return async function check() {
  if (cached && now() >= cached.lastCheckedAt && now() - cached.lastCheckedAt < 60_000) return cached;
  const response = await fetcher('https://otwstatus.statuspage.io/api/v2/summary.json', { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Official status unavailable');
  const result = parseOfficialStatus(await response.json(), now());
  cached = result;
  return result;
 };
}
export const checkOfficialStatus = createOfficialStatusCheck();

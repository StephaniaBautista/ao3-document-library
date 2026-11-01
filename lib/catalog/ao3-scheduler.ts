import { checkAo3 } from './ao3-monitor.ts';
import { sendRecoveryNotifications } from './ao3-notifications.ts';
import { hasConfirmedRecovery } from './ao3-state.mjs';
import type { MailEnvironment } from '../email-transport.ts';

type Env = Pick<Cloudflare.Env, 'DB'> & MailEnvironment;

export async function checkAo3AndNotify(env: Env) {
 if (!env.DB) return;
 const state = await checkAo3(env.DB);
 if (hasConfirmedRecovery(state) && state.recoveredAt !== null) await sendRecoveryNotifications(env, state.recoveredAt);
}

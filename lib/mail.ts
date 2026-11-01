import { env } from 'cloudflare:workers';
import { sendMail } from './email-transport';
import { resetPasswordEmail, verificationEmail } from './verification-email';

export async function sendAccountEmail(to: string, url: string, purpose: 'verify' | 'reset') {
  const message = purpose === 'verify' ? verificationEmail(url) : resetPasswordEmail(url);
  const result = await sendMail(env, { to, ...message });
  if (result !== 'accepted') throw new Error('Could not send account email');
}

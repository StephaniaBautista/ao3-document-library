export type MailEnvironment = Pick<Cloudflare.Env, 'BREVO_API_KEY' | 'BREVO_FROM_EMAIL' | 'BREVO_FROM_NAME' | 'POSTMARK_SERVER_TOKEN' | 'POSTMARK_FROM_EMAIL' | 'POSTMARK_MESSAGE_STREAM'>;
export type MailResult = 'accepted' | 'failed' | 'rate_limited' | 'unknown';
type MailAttachment = { name: string; content: string; contentType: string };
type MailMessage = { to: string; subject: string; text: string; html: string; attachments?: MailAttachment[] };

// A partially configured Brevo installation must not silently send via Postmark.
function hasBrevoConfiguration(env: MailEnvironment) {
 return Boolean(env.BREVO_API_KEY || env.BREVO_FROM_EMAIL || env.BREVO_FROM_NAME);
}
export function isMailConfigured(env: MailEnvironment) {
 return hasBrevoConfiguration(env) ? Boolean(env.BREVO_API_KEY && env.BREVO_FROM_EMAIL) : Boolean(env.POSTMARK_SERVER_TOKEN && env.POSTMARK_FROM_EMAIL);
}

/** Do not retry an unknown result: the provider may have accepted the message. */
export async function sendMail(env: MailEnvironment, message: MailMessage): Promise<MailResult> {
 if (!isMailConfigured(env)) return 'failed';
 const brevo = hasBrevoConfiguration(env);
 const url = brevo ? 'https://api.brevo.com/v3/smtp/email' : 'https://api.postmarkapp.com/email';
 const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
 if (brevo) headers['api-key'] = env.BREVO_API_KEY!;
 else headers['X-Postmark-Server-Token'] = env.POSTMARK_SERVER_TOKEN!;
 const body = brevo ? {
  sender: { email: env.BREVO_FROM_EMAIL, ...(env.BREVO_FROM_NAME ? { name: env.BREVO_FROM_NAME } : {}) },
  to: [{ email: message.to }], subject: message.subject, textContent: message.text, htmlContent: message.html,
  ...(message.attachments?.length ? { attachment: message.attachments.map(file => ({ name: file.name, content: file.content })) } : {}),
 } : {
  From: env.POSTMARK_FROM_EMAIL, To: message.to, Subject: message.subject, TextBody: message.text, HtmlBody: message.html,
  MessageStream: env.POSTMARK_MESSAGE_STREAM || 'outbound', TrackOpens: false, TrackLinks: 'None',
  ...(message.attachments?.length ? { Attachments: message.attachments.map(file => ({ Name: file.name, Content: file.content, ContentType: file.contentType })) } : {}),
 };
 try {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(10000) });
  if (response.ok) {
   const payload = await response.json() as { messageId?: unknown; ErrorCode?: unknown; MessageID?: unknown };
   return brevo ? (typeof payload.messageId === 'string' && payload.messageId ? 'accepted' : 'unknown') : (payload.ErrorCode === 0 && typeof payload.MessageID === 'string' && payload.MessageID ? 'accepted' : 'unknown');
  }
  if (brevo && response.status === 429) return 'rate_limited';
  return response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429 ? 'failed' : 'unknown';
 } catch { return 'unknown'; }
}

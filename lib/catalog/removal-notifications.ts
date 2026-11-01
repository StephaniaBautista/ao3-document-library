import { isMailConfigured, sendMail, type MailEnvironment } from '../email-transport.ts';

type RemovalEnvironment = Pick<Cloudflare.Env, 'DB' | 'REMOVAL_REQUEST_EMAIL'> & MailEnvironment;
type RemovalEmailRow = { storyDescription: string; storyTitle: string | null; proof: string; links: string; requesterEmail: string };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function formatRemovalEmail(row: RemovalEmailRow) {
 const links = JSON.parse(row.links) as string[];
 const title = row.storyTitle || row.storyDescription;
 const parts = ['New removal request', `Story: ${title}`, ...(row.storyTitle && row.storyDescription !== row.storyTitle ? [`Submitted description: ${row.storyDescription}`] : []), `Requester: ${row.requesterEmail}`, '', 'Explanation:', row.proof || '(No explanation)', '', 'Evidence links:', ...(links.length ? links : ['(No links)']), '', 'Any images are included as attachments. You can also review the request in the library.'];
 const text = parts.join('\n');
 const html = `<h1>New removal request</h1><p><strong>Story:</strong> ${escapeHtml(title)}</p>${row.storyTitle && row.storyDescription !== row.storyTitle ? `<p><strong>Submitted description:</strong> ${escapeHtml(row.storyDescription)}</p>` : ''}<p><strong>Requester:</strong> ${escapeHtml(row.requesterEmail)}</p><h2>Explanation</h2><p>${escapeHtml(row.proof || '(No explanation)').replace(/\n/g, '<br>')}</p><h2>Evidence links</h2>${links.length ? `<ul>${links.map(link => `<li><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></li>`).join('')}</ul>` : '<p>No links.</p>'}<p>Any images are included as attachments. You can also review the request in the library.</p>`;
 return { text, html };
}

function toBase64(data: number[]) {
 const bytes = new Uint8Array(data); let binary = '';
 for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
 return btoa(binary);
}

/** A claimed message is never retried after an ambiguous provider response. */
export async function sendRemovalNotification(env: RemovalEnvironment, id: string) {
 const db = env.DB, recipient = env.REMOVAL_REQUEST_EMAIL?.trim();
 if (!db || !recipient || !isMailConfigured(env)) return 'pending';
 const claimed = await db.prepare("UPDATE removal_requests SET email_status = 'sending', email_attempted_at = ? WHERE id = ? AND status = 'pending' AND email_status = 'pending' RETURNING id").bind(Date.now(), id).first();
 if (!claimed) return 'unchanged';
 try {
  const row = await db.prepare('SELECT r.story_description AS storyDescription, s.title AS storyTitle, r.proof, r.links, u.email AS requesterEmail FROM removal_requests r JOIN user u ON u.id = r.requester_id LEFT JOIN shared_stories s ON s.id = r.story_id WHERE r.id = ?').bind(id).first<RemovalEmailRow>();
  if (!row) return 'unchanged';
  const images = await db.prepare('SELECT content_type AS contentType, data FROM removal_evidence_images WHERE request_id = ? ORDER BY id').bind(id).all<{ contentType: string; data: number[] }>();
  const attachments = images.results.map((image, index) => ({ name: `evidence-${index + 1}.${image.contentType === 'image/jpeg' ? 'jpg' : image.contentType === 'image/png' ? 'png' : 'webp'}`, contentType: image.contentType, content: toBase64(image.data) }));
  const result = await sendMail(env, { to: recipient, subject: 'New story removal request', ...formatRemovalEmail(row), attachments });
  const status = result === 'accepted' ? 'sent' : result === 'rate_limited' ? 'pending' : result;
  await db.prepare("UPDATE removal_requests SET email_status = ? WHERE id = ? AND email_status = 'sending'").bind(status, id).run();
  return status;
 } catch {
  await db.prepare("UPDATE removal_requests SET email_status = 'unknown' WHERE id = ? AND email_status = 'sending'").bind(id).run();
  return 'unknown';
 }
}

export async function processRemovalNotifications(env: RemovalEnvironment) {
 const db = env.DB;
 if (!db || !env.REMOVAL_REQUEST_EMAIL?.trim() || !isMailConfigured(env)) return;
 await db.prepare("UPDATE removal_requests SET email_status = 'unknown' WHERE email_status = 'sending' AND email_attempted_at < ?").bind(Date.now() - 15 * 60_000).run();
 const rows = await db.prepare("SELECT id FROM removal_requests WHERE status = 'pending' AND email_status = 'pending' ORDER BY created_at LIMIT 10").all<{ id: string }>();
 for (const row of rows.results) {
  const result = await sendRemovalNotification(env, row.id);
  if (result === 'pending') break;
 }
}

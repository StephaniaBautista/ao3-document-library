import { visibleAo3State } from './ao3-state.mjs';
import { isMailConfigured, sendMail, type MailEnvironment } from '../email-transport.ts';

type NotificationEnvironment = Pick<Cloudflare.Env, 'DB'> & MailEnvironment;
type ReminderRow = { storyId: string; title: string; ao3Url: string | null; action: 'kudo' | 'comment'; comment: string | null };

function escapeHtml(value: string) {
 return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function formatRecoveryEmail(rows: ReminderRow[]) {
 const groups = new Map<string, { title: string; url: string | null; kudo: boolean; comments: string[] }>();
 for (const row of rows) {
  let group = groups.get(row.storyId);
  if (!group) {
   const match = row.ao3Url?.match(/^https:\/\/archiveofourown\.org\/works\/(\d+)$/);
   group = { title: row.title, url: match ? `https://archiveofourown.org/works/${match[1]}` : null, kudo: false, comments: [] };
   groups.set(row.storyId, group);
  }
  if (row.action === 'kudo') group.kudo = true;
  else if (row.comment) group.comments.push(row.comment);
 }
 const intro = ['Hello! AO3 is back.', 'Before you go, remember the kudos and comments you wanted to leave for the authors.'];
 const text = [...intro, '', ...Array.from(groups.values()).flatMap(group => [group.title, group.url || 'AO3 link unavailable', ...(group.kudo ? ['Leave kudos on the work.'] : []), ...group.comments.flatMap(comment => ['Your comment to post on AO3:', comment]), '']), 'Open each work on AO3 to leave kudos or post your comment.'].join('\n');
 const cards = Array.from(groups.values()).map(group => {
  const link = group.url ? `<a href="${escapeHtml(group.url)}" style="display:inline-block;background:#a43e3f;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;line-height:20px;padding:12px 18px;border-radius:5px;">Open work on AO3 &rarr;</a>` : '<span style="font-size:14px;color:#77656a;">AO3 link unavailable.</span>';
  const comments = group.comments.map(comment => `<div style="background:#f8f4ee;border-left:3px solid #d5b9a8;padding:14px 16px;margin:0 0 16px;"><p style="margin:0 0 8px;color:#74575b;font:700 11px/16px Arial,sans-serif;letter-spacing:0.8px;text-transform:uppercase;">Your saved comment</p><p style="margin:0;color:#38282c;font:15px/24px Arial,sans-serif;overflow-wrap:anywhere;">${escapeHtml(comment).replace(/\n/g, '<br>')}</p></div>`).join('');
  return `<tr><td style="padding:22px 0;border-top:1px solid #e9ddd1;"><h3 style="margin:0 0 10px;color:#35262a;font:normal 23px/30px Georgia,serif;overflow-wrap:anywhere;">${escapeHtml(group.title)}</h3>${group.kudo ? '<p style="margin:0 0 16px;color:#8a3436;font:700 13px/20px Arial,sans-serif;">&#9825; Kudos reminder</p>' : ''}${comments}${link}</td></tr>`;
 }).join('');
 const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><title>Your AO3 reminders</title></head><body><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f5f0e9;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;max-width:620px;background:#fffdfa;"><tr><td style="height:6px;background:#a43e3f;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:32px 28px 8px;"><p style="margin:0 0 28px;color:#8a3436;font:700 11px/16px Arial,sans-serif;letter-spacing:1.8px;text-transform:uppercase;">REMINDERS</p><!-- TEST_NOTICE --><h1 style="margin:0 0 16px;color:#35262a;font:normal 32px/40px Georgia,serif;">AO3 is back!</h1><p style="margin:0 0 14px;color:#4a383c;font:16px/26px Arial,sans-serif;">Remember the kudos and comments you wanted to leave for the authors.</p><p style="margin:0 0 28px;color:#6e5d61;font:14px/22px Arial,sans-serif;">Here are your saved reminders:</p><h2 style="margin:0 0 14px;color:#74575b;font:700 11px/16px Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;">Your works</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${cards}</table></td></tr><tr><td style="padding:20px 28px 28px;border-top:1px solid #e9ddd1;color:#6e5d61;font:13px/21px Arial,sans-serif;">Open each work on AO3 to leave kudos or post your comment. The library does not post them for you.</td></tr></table></td></tr></table></body></html>`;
 return { text, html };
}

/** A timeout after sending has unknown outcome. Never automatically resend it. */
export async function sendRecoveryNotifications(env: NotificationEnvironment, recoveryAt: number) {
 const db = env.DB;
 if (!db || !isMailConfigured(env)) return;
 const now = Date.now();
 await db.prepare("UPDATE notification_batches SET state = 'unknown' WHERE state = 'sending' AND COALESCE(attempted_at, created_at) < ?").bind(now - 900_000).run();
 await db.prepare("INSERT OR IGNORE INTO notification_batches (id, user_id, recovery_at, state, created_at) SELECT lower(hex(randomblob(16))), r.user_id, ?, 'pending', ? FROM reminders r JOIN user u ON u.id = r.user_id JOIN library_profiles p ON p.user_id = u.id WHERE r.created_at <= ? AND u.email_verified = 1 AND p.blocked = 0 AND p.age_verified = 1 AND NOT EXISTS (SELECT 1 FROM notification_items old_i JOIN notification_batches old_b ON old_b.id = old_i.batch_id WHERE old_i.reminder_id = r.id AND old_b.state IN ('pending', 'sending', 'unknown')) GROUP BY r.user_id")
  .bind(recoveryAt, now, recoveryAt).run();
 await db.prepare("INSERT OR IGNORE INTO notification_items (id, batch_id, reminder_id) SELECT lower(hex(randomblob(16))), b.id, r.id FROM notification_batches b JOIN reminders r ON r.user_id = b.user_id WHERE b.recovery_at = ? AND b.state = 'pending' AND r.created_at <= ? AND NOT EXISTS (SELECT 1 FROM notification_items old_i JOIN notification_batches old_b ON old_b.id = old_i.batch_id WHERE old_i.reminder_id = r.id AND old_b.id != b.id AND old_b.state IN ('pending', 'sending', 'unknown'))")
  .bind(recoveryAt, recoveryAt).run();
 const batches = await db.prepare("SELECT id, user_id AS userId FROM notification_batches WHERE state = 'pending' ORDER BY created_at LIMIT 100").all<{ id: string; userId: string }>();
 for (const batch of batches.results) {
  const claimed = await db.prepare("UPDATE notification_batches SET state = 'sending', attempted_at = ? WHERE id = ? AND state = 'pending' RETURNING id").bind(Date.now(), batch.id).first();
  if (!claimed) continue;
  const user = await db.prepare('SELECT u.email FROM user u JOIN library_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.email_verified = 1 AND p.blocked = 0 AND p.age_verified = 1').bind(batch.userId).first<{ email: string }>();
  const rows = await db.prepare('SELECT s.id AS storyId, s.title, s.ao3_url AS ao3Url, r.action, r.comment FROM notification_items i JOIN reminders r ON r.id = i.reminder_id JOIN shared_stories s ON s.id = r.story_id WHERE i.batch_id = ? ORDER BY r.created_at').bind(batch.id).all<ReminderRow>();
  if (!user || !rows.results.length) { await db.prepare("UPDATE notification_batches SET state = 'failed' WHERE id = ?").bind(batch.id).run(); continue; }
  const status = await db.prepare('SELECT state, last_checked_at AS lastCheckedAt, last_observation AS lastObservation, consecutive_successes AS consecutiveSuccesses, consecutive_failures AS consecutiveFailures FROM ao3_status WHERE id = ?').bind('ao3').first<{ state: string; lastCheckedAt: number | null; lastObservation: string | null; consecutiveSuccesses: number; consecutiveFailures: number }>();
  if (visibleAo3State(status) !== 'up') {
   await db.prepare("UPDATE notification_batches SET state = 'pending', attempted_at = NULL WHERE id = ? AND state = 'sending'").bind(batch.id).run();
   break;
  }
  const { text, html } = formatRecoveryEmail(rows.results);
  const result = await sendMail(env, { to: user.email, subject: 'AO3 is back: your reminders', text, html });
  if (result === 'rate_limited') {
   await db.prepare("UPDATE notification_batches SET state = 'pending', attempted_at = NULL WHERE id = ? AND state = 'sending'").bind(batch.id).run();
   break;
  }
  if (result === 'accepted') {
   await db.batch([
    db.prepare('DELETE FROM reminders WHERE id IN (SELECT reminder_id FROM notification_items WHERE batch_id = ?)').bind(batch.id),
    db.prepare("UPDATE notification_batches SET state = 'sent' WHERE id = ? AND state = 'sending'").bind(batch.id),
   ]);
  } else {
   await db.prepare('UPDATE notification_batches SET state = ? WHERE id = ? AND state = ?').bind(result, batch.id, 'sending').run();
  }
 }
}

import type { UserCursor } from './users-query.ts';

type ReminderRow = { id: string; storyId: string; action: string; comment: string | null; createdAt: number; title: string; ao3Url: string | null };

/** Page by creation time and id so equal timestamps and deletions remain safe. */
export async function listReminders(db: D1Database, userId: string, cursor: UserCursor | null, pageSize = 50) {
 const columns = 'r.id, r.story_id AS storyId, r.action, r.comment, r.created_at AS createdAt, s.title, s.ao3_url AS ao3Url';
 const order = ' ORDER BY r.created_at DESC, r.id ASC LIMIT ?';
 const rows = cursor
  ? await db.prepare(`SELECT ${columns} FROM reminders r JOIN shared_stories s ON s.id = r.story_id WHERE r.user_id = ? AND (r.created_at < ? OR (r.created_at = ? AND r.id > ?))${order}`).bind(userId, cursor.createdAt, cursor.createdAt, cursor.id, pageSize + 1).all<ReminderRow>()
  : await db.prepare(`SELECT ${columns} FROM reminders r JOIN shared_stories s ON s.id = r.story_id WHERE r.user_id = ?${order}`).bind(userId, pageSize + 1).all<ReminderRow>();
 const reminders = rows.results.slice(0, pageSize), last = reminders.at(-1);
 return { reminders, nextCursor: rows.results.length > pageSize && last ? { createdAt: last.createdAt, id: last.id } : null };
}

import type { UserCursor } from './users-query.ts';

type NotificationRow = { id: string; state: string; email: string; createdAt: number };

/** Keep every unresolved notification reachable, even when timestamps match. */
export async function listNotificationIssues(db: D1Database, cursor: UserCursor | null, pageSize = 50) {
 const rows = cursor
  ? await db.prepare("SELECT b.id, b.state, b.created_at AS createdAt, u.email FROM notification_batches b JOIN user u ON u.id = b.user_id WHERE b.state IN ('failed', 'unknown', 'sending') AND (b.created_at > ? OR (b.created_at = ? AND b.id > ?)) ORDER BY b.created_at, b.id LIMIT ?").bind(cursor.createdAt, cursor.createdAt, cursor.id, pageSize + 1).all<NotificationRow>()
  : await db.prepare("SELECT b.id, b.state, b.created_at AS createdAt, u.email FROM notification_batches b JOIN user u ON u.id = b.user_id WHERE b.state IN ('failed', 'unknown', 'sending') ORDER BY b.created_at, b.id LIMIT ?").bind(pageSize + 1).all<NotificationRow>();
 const notifications = rows.results.slice(0, pageSize), last = notifications.at(-1);
 return { notifications, nextCursor: rows.results.length > pageSize && last ? { createdAt: last.createdAt, id: last.id } : null };
}

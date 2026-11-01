export type UserCursor = { createdAt: number; id: string };
type UserRow = { id: string; name: string; email: string; role: string; blocked: number; createdAt: number };

export function parseUserCursor(time: string | null, id: string | null): UserCursor | null | false {
 if (time === null && id === null) return null;
 if (!time || !/^\d{1,16}$/.test(time) || !id || id.length > 256 || /[\x00-\x1f]/.test(id)) return false;
 const createdAt = Number(time);
 return Number.isSafeInteger(createdAt) ? { createdAt, id } : false;
}

export async function listAdminUsers(db: D1Database, search: string, cursor: UserCursor | null, pageSize = 50) {
 const conditions: string[] = [], values: (string | number)[] = [];
 if (search) {
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  conditions.push("(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
  values.push(pattern, pattern);
 }
 if (cursor) {
  conditions.push('(u.created_at < ? OR (u.created_at = ? AND u.id > ?))');
  values.push(cursor.createdAt, cursor.createdAt, cursor.id);
 }
 values.push(pageSize + 1);
 const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
 const rows = await db.prepare(`SELECT u.id, u.name, u.email, u.created_at AS createdAt, COALESCE(p.role, 'user') AS role, COALESCE(p.blocked, 0) AS blocked FROM user u LEFT JOIN library_profiles p ON p.user_id = u.id ${where} ORDER BY u.created_at DESC, u.id ASC LIMIT ?`).bind(...values).all<UserRow>();
 const users = rows.results.slice(0, pageSize), last = users.at(-1);
 return { users, nextCursor: rows.results.length > pageSize && last ? { createdAt: last.createdAt, id: last.id } : null };
}

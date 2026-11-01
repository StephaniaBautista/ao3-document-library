type Failure = { id: string; name: string; error: string | null; path: string };

export function parseFailureCursor(value: string | null): string | null | false {
 if (value === null) return null;
 return /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : false;
}

/** Page failures by stable item ID and reconstruct their imported folder path. */
export async function listDriveFailures(db: D1Database, jobId: string, afterId: string | null, pageSize = 50) {
 const sql = `WITH RECURSIVE page AS (
  SELECT id, name, error, parent_item_id FROM drive_import_items
  WHERE job_id = ? AND state = 'failed' AND (? IS NULL OR id > ?)
  ORDER BY id LIMIT ?
 ), ancestors(failure_id, parent_item_id, path, depth) AS (
  SELECT id, parent_item_id, name, 0 FROM page
  UNION ALL
  SELECT a.failure_id, p.parent_item_id, p.name || ' / ' || a.path, a.depth + 1
  FROM ancestors a JOIN drive_import_items p ON p.id = a.parent_item_id AND p.job_id = ?
  WHERE a.depth < 100
 )
 SELECT p.id, p.name, p.error, COALESCE((SELECT CASE WHEN a.depth = 100 AND a.parent_item_id IS NOT NULL THEN '… / ' || a.path ELSE a.path END FROM ancestors a WHERE a.failure_id = p.id ORDER BY a.depth DESC LIMIT 1), p.name) AS path
 FROM page p ORDER BY p.id`;
 const rows = await db.prepare(sql).bind(jobId, afterId, afterId, pageSize + 1, jobId).all<Failure>();
 const failures = rows.results.slice(0, pageSize), last = failures.at(-1);
 return { failures, nextFailureCursor: rows.results.length > pageSize && last ? last.id : null };
}

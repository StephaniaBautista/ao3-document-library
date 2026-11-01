type DeletionEnv = Pick<Cloudflare.Env, 'DB' | 'BUCKET'>;
const tombstoneLifetime = 25 * 60 * 60 * 1000;

/** Remove a catalog row and record its object for deletion in one transaction. */
export async function removeStory(db: D1Database, storyId: string) {
 const row = await db.prepare('SELECT object_key AS objectKey FROM shared_stories WHERE id = ?').bind(storyId).first<{ objectKey: string }>();
 if (!row) return null;
 const results = await db.batch([
  db.prepare('INSERT OR IGNORE INTO object_deletions (object_key, queued_at) SELECT object_key, ? FROM shared_stories WHERE id = ? AND object_key = ?').bind(Date.now(), storyId, row.objectKey),
  db.prepare('DELETE FROM shared_stories WHERE id = ? AND object_key = ?').bind(storyId, row.objectKey),
  db.prepare('DELETE FROM translation_cache WHERE NOT EXISTS (SELECT 1 FROM translation_cache_refs WHERE cache_id = translation_cache.id)'),
 ]);
 return results[1]?.meta.changes ? row.objectKey : null;
}

/** Approval and removal are atomic; a concurrently withdrawn request cannot delete a story. */
export async function approveRemoval(db: D1Database, requestId: string, storyId: string) {
 const row = await db.prepare("SELECT s.object_key AS objectKey FROM shared_stories s JOIN removal_requests r ON r.story_id = s.id WHERE r.id = ? AND r.status = 'pending' AND s.id = ?").bind(requestId, storyId).first<{ objectKey: string }>();
 if (!row) return null;
 const results = await db.batch([
  db.prepare("UPDATE removal_requests SET status = 'approved' WHERE id = ? AND story_id = ? AND status = 'pending'").bind(requestId, storyId),
  db.prepare("INSERT OR IGNORE INTO object_deletions (object_key, queued_at) SELECT s.object_key, ? FROM shared_stories s JOIN removal_requests r ON r.story_id = s.id WHERE r.id = ? AND r.status = 'approved' AND s.id = ? AND s.object_key = ?").bind(Date.now(), requestId, storyId, row.objectKey),
  db.prepare("DELETE FROM shared_stories WHERE id = ? AND object_key = ? AND EXISTS (SELECT 1 FROM removal_requests WHERE id = ? AND story_id = ? AND status = 'approved')").bind(storyId, row.objectKey, requestId, storyId),
  db.prepare("DELETE FROM removal_requests WHERE id = ? AND status = 'approved' AND story_id IS NULL").bind(requestId),
  db.prepare('DELETE FROM translation_cache WHERE NOT EXISTS (SELECT 1 FROM translation_cache_refs WHERE cache_id = translation_cache.id)'),
 ]);
 return results[2]?.meta.changes ? row.objectKey : null;
}

/** Deleting an already missing object is safe to retry. */
export async function flushObjectDeletion(db: D1Database, bucket: R2Bucket, objectKey: string, now = Date.now()) {
 try {
  const pending = await db.prepare('SELECT object_key FROM object_deletions WHERE object_key = ? AND deleted_at IS NULL').bind(objectKey).first();
  if (!pending) return true;
  if (await db.prepare('SELECT id FROM shared_stories WHERE object_key = ?').bind(objectKey).first()) return false;
  await bucket.delete(objectKey);
  await db.prepare('UPDATE object_deletions SET deleted_at = ? WHERE object_key = ? AND deleted_at IS NULL').bind(now, objectKey).run();
  return true;
 } catch { return false; }
}

export async function processObjectDeletions(env: DeletionEnv, limit = 25) {
 if (!env.DB || !env.BUCKET) return;
 const db = env.DB;
 const pending = await db.prepare('SELECT object_key AS objectKey FROM object_deletions WHERE deleted_at IS NULL ORDER BY queued_at LIMIT ?').bind(limit).all<{ objectKey: string }>();
 for (const row of pending.results) {
  if (!await flushObjectDeletion(db, env.BUCKET, row.objectKey)) {
   // Move failures to the back so one inaccessible object cannot block others.
   await db.prepare('UPDATE object_deletions SET queued_at = ? WHERE object_key = ? AND deleted_at IS NULL').bind(Date.now(), row.objectKey).run();
  }
 }
 // Prevent a still-valid upload ticket from recreating a deleted object.
 await db.prepare('DELETE FROM object_deletions WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(Date.now() - tombstoneLifetime).run();
}

import { flushObjectDeletion } from './object-deletions.ts';
import { manualMetadataColumns } from './manual-metadata.ts';

export async function saveMetadata(db: D1Database, bucket: R2Bucket, storyId: string, metadata: Record<string, unknown>, expectedState: 'pending' | 'processing', claimedAt?: number, retryConflict = true) {
 if (expectedState === 'pending') {
  claimedAt = Date.now();
  const claim = await db.prepare("UPDATE shared_stories SET metadata_status = 'processing', metadata_claimed_at = ? WHERE id = ? AND metadata_status = 'pending' RETURNING id").bind(claimedAt, storyId).first();
  if (!claim) return { ok: false };
  expectedState = 'processing';
 }
 if (claimedAt === undefined) throw new Error('Metadata claim is required');
 const value = (key: string, max = 3000) => typeof metadata[key] === 'string' ? (metadata[key] as string).trim().slice(0, max) || null : null;
 const count = (key: string) => typeof metadata[key] === 'number' && Number.isSafeInteger(metadata[key]) && Number(metadata[key]) >= 0 ? metadata[key] : null;
 const rawUrl = value('ao3Url', 500), workId = rawUrl?.match(/^https:\/\/archiveofourown\.org\/works\/(\d+)$/)?.[1] || null;
 const duplicate = workId ? await db.prepare('SELECT id FROM shared_stories WHERE ao3_work_id = ? AND id <> ?').bind(workId, storyId).first<{ id: string }>() : null;
 if (duplicate) {
  const original = await db.prepare('SELECT object_key AS objectKey FROM shared_stories WHERE id = ? AND metadata_status = ? AND metadata_claimed_at = ?').bind(storyId, expectedState, claimedAt).first<{ objectKey: string }>();
  if (!original) return { ok: false };
  // Both rows must still represent the pair we inspected when the atomic batch starts.
  const guard = 'EXISTS (SELECT 1 FROM shared_stories WHERE id = ? AND metadata_status = ? AND metadata_claimed_at = ?) AND EXISTS (SELECT 1 FROM shared_stories WHERE id = ? AND ao3_work_id = ?)';
  const manualFields = Object.entries(manualMetadataColumns);
  const transfer = manualFields.map(([key, column]) => `${column} = CASE WHEN COALESCE(json_extract((SELECT metadata_manual_fields FROM shared_stories WHERE id = ?), '$.${key}'), 0) > COALESCE(json_extract(metadata_manual_fields, '$.${key}'), 0) THEN (SELECT ${column} FROM shared_stories WHERE id = ?) WHEN COALESCE(json_extract(metadata_manual_fields, '$.${key}'), 0) > 0 THEN ${column} ELSE COALESCE(${column}, (SELECT ${column} FROM shared_stories WHERE id = ?), ?) END`).join(', ');
  const versions = manualFields.map(([key]) => `'$.${key}', MAX(COALESCE(json_extract(metadata_manual_fields, '$.${key}'), 0), COALESCE(json_extract((SELECT metadata_manual_fields FROM shared_stories WHERE id = ?), '$.${key}'), 0))`).join(', ');
  const results = await db.batch([
   db.prepare(`UPDATE shared_stories SET ${transfer}, word_count = COALESCE(word_count, (SELECT word_count FROM shared_stories WHERE id = ?), ?), chapter_count = COALESCE(chapter_count, (SELECT chapter_count FROM shared_stories WHERE id = ?), ?), total_chapters = COALESCE(total_chapters, (SELECT total_chapters FROM shared_stories WHERE id = ?), ?), metadata_manual_fields = json_set(metadata_manual_fields, ${versions}) WHERE id = ? AND ${guard}`).bind(...manualFields.flatMap(([key]) => [storyId, storyId, storyId, value(key, key === 'summary' ? 12000 : key === 'title' ? 300 : 3000)]), storyId, count('wordCount'), storyId, count('chapterCount'), storyId, count('totalChapters'), ...manualFields.map(() => storyId), duplicate.id, storyId, expectedState, claimedAt, duplicate.id, workId),
   db.prepare(`INSERT OR IGNORE INTO favorite_items (id, collection_id, story_id, created_at) SELECT lower(hex(randomblob(16))), collection_id, ?, created_at FROM favorite_items WHERE story_id = ? AND ${guard}`).bind(duplicate.id, storyId, storyId, expectedState, claimedAt, duplicate.id, workId),
   db.prepare(`INSERT OR IGNORE INTO translation_cache_refs (id, cache_id, story_id) SELECT lower(hex(randomblob(16))), cache_id, ? FROM translation_cache_refs WHERE story_id = ? AND ${guard}`).bind(duplicate.id, storyId, storyId, expectedState, claimedAt, duplicate.id, workId),
   db.prepare(`INSERT INTO reading_positions (id, user_id, story_id, location, updated_at) SELECT lower(hex(randomblob(16))), user_id, ?, location, updated_at FROM reading_positions WHERE story_id = ? AND ${guard} AND (SELECT file_type FROM shared_stories WHERE id = ?) = (SELECT file_type FROM shared_stories WHERE id = ?) ON CONFLICT(user_id, story_id) DO UPDATE SET location = excluded.location, updated_at = excluded.updated_at WHERE excluded.updated_at > reading_positions.updated_at`).bind(duplicate.id, storyId, storyId, expectedState, claimedAt, duplicate.id, workId, storyId, duplicate.id),
   db.prepare(`UPDATE reading_notes SET story_id = ? WHERE story_id = ? AND ${guard}`).bind(duplicate.id, storyId, storyId, expectedState, claimedAt, duplicate.id, workId),
   db.prepare(`UPDATE reminders SET story_id = ? WHERE story_id = ? AND ${guard}`).bind(duplicate.id, storyId, storyId, expectedState, claimedAt, duplicate.id, workId),
   db.prepare(`UPDATE removal_requests SET story_id = ? WHERE story_id = ? AND ${guard}`).bind(duplicate.id, storyId, storyId, expectedState, claimedAt, duplicate.id, workId),
   db.prepare(`UPDATE translation_jobs SET story_id = ? WHERE story_id = ? AND ${guard} AND NOT EXISTS (SELECT 1 FROM translation_jobs other WHERE other.story_id = ? AND other.user_id = translation_jobs.user_id AND other.target_language = translation_jobs.target_language)`).bind(duplicate.id, storyId, storyId, expectedState, claimedAt, duplicate.id, workId, duplicate.id),
   db.prepare(`UPDATE drive_import_items SET story_id = ?, duplicate = 1 WHERE (story_id = ? OR (id = ? AND story_id IS NULL)) AND ${guard}`).bind(duplicate.id, storyId, storyId, storyId, expectedState, claimedAt, duplicate.id, workId),
   db.prepare(`INSERT OR IGNORE INTO object_deletions (object_key, queued_at) SELECT object_key, ? FROM shared_stories WHERE id = ? AND metadata_status = ? AND ${guard}`).bind(Date.now(), storyId, expectedState, storyId, expectedState, claimedAt, duplicate.id, workId),
   db.prepare(`DELETE FROM shared_stories WHERE id = ? AND metadata_status = ? AND ${guard}`).bind(storyId, expectedState, storyId, expectedState, claimedAt, duplicate.id, workId),
  ]);
  if (!results[results.length - 1]?.meta.changes) return { ok: false };
  await flushObjectDeletion(db, bucket, original.objectKey);
  return { ok: true, mergedInto: duplicate.id };
 }
 try {
 const fields = Object.entries(manualMetadataColumns);
 const automatic = fields.map(([key, column]) => `${column} = CASE WHEN COALESCE(json_extract(metadata_manual_fields, '$.${key}'), 0) > 0 THEN ${column} ELSE COALESCE(?, ${column}) END`).join(', ');
 const result = await db.prepare(`UPDATE shared_stories SET ${automatic}, word_count = COALESCE(?, word_count), chapter_count = COALESCE(?, chapter_count), total_chapters = COALESCE(?, total_chapters), ao3_url = COALESCE(?, ao3_url), ao3_work_id = COALESCE(?, ao3_work_id), metadata_status = 'done', metadata_claimed_at = NULL WHERE id = ? AND metadata_status = ? AND metadata_claimed_at = ?`)
  .bind(...fields.map(([key]) => value(key, key === 'summary' ? 12000 : key === 'title' ? 300 : 3000)), count('wordCount'), count('chapterCount'), count('totalChapters'), workId ? `https://archiveofourown.org/works/${workId}` : null, workId, storyId, expectedState, claimedAt).run();
 return { ok: !!result.meta.changes };
 } catch (cause) {
  if (retryConflict && workId && await db.prepare('SELECT id FROM shared_stories WHERE ao3_work_id = ? AND id <> ?').bind(workId, storyId).first()) return saveMetadata(db, bucket, storyId, metadata, 'processing', claimedAt, false);
  throw cause;
 }
}

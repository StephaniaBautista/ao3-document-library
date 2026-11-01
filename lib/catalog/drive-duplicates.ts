type Duplicate = { id: string; storyId: string; title: string; sourceImportCreatedAt: number; sourceFolderId: string | null; currentFolderId: string | null; sourcePath: string; currentFolderPath: string; sourceFolderAvailable: boolean };

/** The import item describes an occurrence, while storyId identifies the one retained copy. */
export async function listDriveDuplicates(db: D1Database, jobId: string, afterId: string | null, pageSize = 50) {
 const sql = `WITH RECURSIVE eligible_stories AS (
  SELECT DISTINCT selected.story_id FROM drive_import_jobs selected_job JOIN drive_import_items selected ON selected.job_id = selected_job.id
  WHERE selected_job.id = ? AND selected.state = 'done' AND selected.story_id IS NOT NULL AND (selected.duplicate = 1 OR EXISTS (
   SELECT 1 FROM drive_import_items other JOIN drive_import_jobs other_job ON other_job.id = other.job_id
   WHERE other.story_id = selected.story_id AND other.id <> selected.id AND other.state = 'done' AND other_job.user_id = selected_job.user_id
  ))
 ), page AS (
  SELECT i.id, i.job_id, i.name, i.parent_item_id, i.parent_folder_id AS sourceFolderId, s.id AS storyId, s.title, s.folder_id AS currentFolderId, source_job.created_at AS sourceImportCreatedAt
  FROM eligible_stories eligible JOIN drive_import_items i ON i.story_id = eligible.story_id AND i.state = 'done' JOIN shared_stories s ON s.id = i.story_id
  JOIN drive_import_jobs source_job ON source_job.id = i.job_id
  JOIN drive_import_jobs selected_job ON selected_job.id = ? AND selected_job.user_id = source_job.user_id
  WHERE (? IS NULL OR i.id > ?)
  ORDER BY i.id LIMIT ?
 ), source_ancestors(item_id, job_id, parent_item_id, path, depth) AS (
  SELECT id, job_id, parent_item_id, name, 0 FROM page
  UNION ALL SELECT a.item_id, a.job_id, p.parent_item_id, p.name || ' / ' || a.path, a.depth + 1
  FROM source_ancestors a JOIN drive_import_items p ON p.id = a.parent_item_id AND p.job_id = a.job_id WHERE a.depth < 100
 ), current_ancestors(item_id, parent_id, path, depth) AS (
  SELECT p.id, f.parent_id, f.name, 0 FROM page p JOIN shared_folders f ON f.id = p.currentFolderId
  UNION ALL SELECT a.item_id, f.parent_id, f.name || ' / ' || a.path, a.depth + 1
  FROM current_ancestors a JOIN shared_folders f ON f.id = a.parent_id WHERE a.depth < 100
 )
 SELECT p.id, p.storyId, p.title, p.sourceImportCreatedAt, p.sourceFolderId, p.currentFolderId,
  COALESCE((SELECT CASE WHEN a.depth = 100 AND a.parent_item_id IS NOT NULL THEN '… / ' || a.path ELSE a.path END FROM source_ancestors a WHERE a.item_id = p.id ORDER BY a.depth DESC LIMIT 1), p.name) AS sourcePath,
  COALESCE((SELECT CASE WHEN a.depth = 100 AND a.parent_id IS NOT NULL THEN '… / ' || a.path ELSE a.path END FROM current_ancestors a WHERE a.item_id = p.id ORDER BY a.depth DESC LIMIT 1), 'Library root') AS currentFolderPath
 FROM page p ORDER BY p.id`;
 const rows = await db.prepare(sql).bind(jobId, jobId, afterId, afterId, pageSize + 1).all<Duplicate>();
 const duplicates = rows.results.slice(0, pageSize).map(row => ({ ...row, sourceFolderAvailable: row.sourceFolderId !== null })), last = duplicates.at(-1);
 return { duplicates, nextDuplicateCursor: rows.results.length > pageSize && last ? last.id : null };
}

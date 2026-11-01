/** Delete only an empty folder not needed by an active import, atomically. */
export async function deleteEmptyFolder(db: D1Database, folderId: string) {
 const guard = `EXISTS (SELECT 1 FROM shared_folders f WHERE f.id = ?
  AND NOT EXISTS (SELECT 1 FROM shared_folders child WHERE child.parent_id = f.id)
  AND NOT EXISTS (SELECT 1 FROM shared_stories s WHERE s.folder_id = f.id)
  AND NOT EXISTS (SELECT 1 FROM drive_import_items i WHERE (i.parent_folder_id = f.id OR i.catalog_folder_id = f.id) AND i.state IN ('pending', 'processing')))`;
 // Keep completed import records and their source paths, but detach the deleted folder.
 // The whole batch is one transaction, so an intervening import cannot lose its destination.
 const results = await db.batch([
  db.prepare(`UPDATE drive_import_items SET parent_folder_id = NULL WHERE parent_folder_id = ? AND ${guard}`).bind(folderId, folderId),
  db.prepare(`UPDATE drive_import_items SET catalog_folder_id = NULL WHERE catalog_folder_id = ? AND ${guard}`).bind(folderId, folderId),
  db.prepare(`DELETE FROM shared_folders WHERE id = ? AND ${guard}`).bind(folderId, folderId),
 ]);
 return !!results[2]?.meta.changes;
}

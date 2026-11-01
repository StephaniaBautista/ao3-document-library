export const manualMetadataColumns = { title: 'title', author: 'author', summary: 'summary', fandom: 'fandom', relationship: 'relationship', tags: 'tags', warnings: 'warnings', language: 'language', rating: 'rating', category: 'category', characters: 'characters' } as const;
type ManualKey = keyof typeof manualMetadataColumns;
type Edit = { key: ManualKey; value: string | null };

export function parseManualMetadata(metadata: unknown): Edit[] | null {
 if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
 const data = metadata as Record<string, unknown>, result: Edit[] = [];
 for (const key of Object.keys(manualMetadataColumns) as ManualKey[]) {
  if (!(key in data)) continue;
  const value = data[key];
  if (typeof value !== 'string' || value.length > (key === 'summary' ? 12000 : 3000) || (key === 'title' && !value.trim())) return null;
  result.push({ key, value: value.trim() || null });
 }
 return result.length ? result : null;
}

/** Update only edited fields and remember them so extraction cannot overwrite them. */
export async function saveManualMetadata(db: D1Database, id: string, edits: Edit[], revision = Date.now()) {
 const assignments = edits.map(edit => `${manualMetadataColumns[edit.key]} = ?`);
 const mask = edits.map(edit => `'$.${edit.key}', ?`).join(', ');
 const result = await db.prepare(`UPDATE shared_stories SET ${assignments.join(', ')}, metadata_manual_fields = json_set(metadata_manual_fields, ${mask}) WHERE id = ?`).bind(...edits.map(edit => edit.value), ...edits.map(() => revision), id).run();
 return !!result.meta.changes;
}

/** Reuse a unique matching root folder; never silently choose between ambiguous names. */
export async function fandomFolder(db: D1Database, value: string | null) {
 const name = (value || '').split(/[,;\n]/)[0].trim().slice(0, 180);
 if (!name || /[\x00-\x1f/\\]/.test(name)) return null;
 const rows = await db.prepare('SELECT id, name FROM shared_folders WHERE parent_id IS NULL').all<{ id: string; name: string }>();
 const exact = rows.results.find(folder => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase());
 if (exact) return exact.id;
 const base = (input: string) => input.replace(/\s*\([^)]*\)\s*/g, ' ').trim().toLocaleLowerCase();
 const matching = rows.results.filter(folder => base(folder.name) === base(name));
 if (matching.length === 1) return matching[0].id;
 if (matching.length > 1) return null;
 const id = crypto.randomUUID();
 try {
  await db.prepare('INSERT INTO shared_folders (id, parent_id, name, created_at) VALUES (?, NULL, ?, ?)').bind(id, name, Date.now()).run();
  return id;
 } catch (cause) {
  const concurrent = await db.prepare('SELECT id FROM shared_folders WHERE parent_id IS NULL AND name = ? COLLATE NOCASE').bind(name).first<{ id: string }>();
  if (concurrent) return concurrent.id;
  throw cause;
 }
}

import { extractMetadata } from './extract-metadata';

type Metadata = { title?: string; author?: string; summary?: string; fandom?: string; relationship?: string; characters?: string; tags?: string; warnings?: string; ao3Url?: string };

/** Publish a selected browser-local file through the normal catalog upload route. */
export async function publishLocalFile(file: File, fallback: Metadata = {}): Promise<{ duplicate: boolean }> {
 const type = /\.epub$/i.test(file.name) ? 'epub' : /\.pdf$/i.test(file.name) ? 'pdf' : null;
 if (!type) throw new Error('Only PDF or EPUB files can be published.');
 let metadata: Metadata = {};
 try { metadata = await extractMetadata(file, type); } catch { /* The catalog can extract metadata later. */ }
 const fields = ['title', 'author', 'summary', 'fandom', 'relationship', 'characters', 'tags', 'warnings', 'ao3Url'] as const;
 const merged: Record<string, unknown> = Object.fromEntries(fields.map(key => [key, fallback[key]]));
 for (const [key, value] of Object.entries(metadata)) if (value !== undefined && value !== null && value !== '') merged[key] = value;
 return uploadCatalogFile(file, merged);
}

export async function uploadCatalogFile(file: File, metadata: object): Promise<{ duplicate: boolean }> {
 const form = new FormData(); form.append('file', file);
 for (const [key, value] of Object.entries(metadata)) if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
 let response: Response;
 try { response = await fetch('/api/catalog/stories', { method: 'PUT', body: form }); }
 catch { throw new Error("Could not confirm publication. Check the catalog before retrying."); }
 if (!response.ok) {
  if (response.status === 401 || response.status === 403) throw new Error("Your session cannot publish. Sign in again.");
  if (response.status === 413) throw new Error("The file exceeds the size limit.");
  if (response.status === 400 || response.status === 415) throw new Error("The file format is invalid.");
  throw new Error("Could not confirm publication. Check the catalog before retrying.");
 }
 let result: { duplicate?: unknown };
 try { result = await response.json() as { duplicate?: unknown }; } catch { throw new Error("Could not confirm publication. Check the catalog before retrying."); }
 if (typeof result.duplicate !== 'boolean') throw new Error("Could not confirm publication. Check the catalog before retrying.");
 return { duplicate: result.duplicate };
}

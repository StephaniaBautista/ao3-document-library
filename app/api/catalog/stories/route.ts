import { catalogAccess } from '@/lib/catalog/access';
import { buildStoryQuery } from '@/lib/catalog/story-query';
import { fandomFolder } from '@/lib/catalog/fandom-folder';

export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
const metadataFields = ['title', 'author', 'summary', 'fandom', 'relationship', 'tags', 'warnings', 'language', 'rating', 'category', 'characters'] as const;
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');

export async function GET(req: Request) {
 const access = await catalogAccess(req);
 if (access.error) return access.error;
 const statement = buildStoryQuery(new URL(req.url).searchParams);
 if ('error' in statement) return error(statement.error || 'Invalid filters.');
 const rows = await access.context.db.prepare(statement.sql).bind(...statement.values).all();
 return Response.json({ stories: rows.results.slice(0, statement.limit), hasMore: rows.results.length > statement.limit }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
 const access = await catalogAccess(req, true);
 if (access.error) return access.error;
 const length = Number(req.headers.get('content-length') || 0);
 if (length > 52 * 1024 * 1024) return error('File exceeds the current technical limit.', 413);
 let data: FormData;
 try { data = await req.formData(); } catch { return error('Invalid upload.'); }
 const file = data.get('file');
 if (!(file instanceof File) || !file.size || file.size > 50 * 1024 * 1024) return error('File exceeds the current technical limit.', 413);
 const filename = file.name.replace(/[\x00-\x1f/\\]/g, '_').slice(0, 180);
 const extension = filename.split('.').pop()?.toLowerCase();
 const bytes = await file.arrayBuffer();
 const head = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
 const validPdf = extension === 'pdf' && String.fromCharCode(...head) === '%PDF-';
 const validEpub = extension === 'epub' && head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;
 const validHtml = (extension === 'html' || extension === 'htm') && !head.includes(0);
 if (!validPdf && !validEpub && !validHtml) return error("Only PDF, EPUB and HTML files are supported.");
 const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
 const metadata = Object.fromEntries(metadataFields.map(key => { const value = data.get(key); return [key, typeof value === 'string' ? value.trim().slice(0, key === 'summary' ? 12000 : 3000) || null : null]; })) as Record<(typeof metadataFields)[number], string | null>;
 const folder = await fandomFolder(access.context.db, metadata.fandom);
 const count = (key: string) => { const value = data.get(key); return typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : null; };
 const rawUrl = data.get('ao3Url');
 const workId = typeof rawUrl === 'string' ? rawUrl.match(/^https?:\/\/(?:www\.)?archiveofourown\.org\/works\/(\d+)\/?$/i)?.[1] || null : null;
 const ao3Url = workId ? `https://archiveofourown.org/works/${workId}` : null;
 const duplicate = await access.context.db.prepare('SELECT id FROM shared_stories WHERE content_hash = ? OR (ao3_work_id IS NOT NULL AND ao3_work_id = ?)').bind(hash, workId).first<{ id: string }>();
 if (duplicate) return Response.json({ id: duplicate.id, duplicate: true });
 const id = crypto.randomUUID(), objectKey = `catalog/${id}`;
 await access.context.bucket.put(objectKey, bytes, { httpMetadata: { contentType: validPdf ? 'application/pdf' : validEpub ? 'application/epub+zip' : 'text/html' } });
 try {
  await access.context.db.prepare('INSERT INTO shared_stories (id, folder_id, submitted_by, filename, file_type, size, object_key, content_hash, title, author, summary, fandom, relationship, tags, warnings, language, rating, category, characters, word_count, chapter_count, total_chapters, ao3_url, ao3_work_id, created_at, metadata_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
   .bind(id, folder, access.context.userId, filename, validPdf ? 'pdf' : validEpub ? 'epub' : 'html', file.size, objectKey, hash, metadata.title || filename.replace(/\.(pdf|epub|html?)$/i, ''), metadata.author, metadata.summary, metadata.fandom, metadata.relationship, metadata.tags, metadata.warnings, metadata.language, metadata.rating, metadata.category, metadata.characters, count('wordCount'), count('chapterCount'), count('totalChapters'), ao3Url, workId, Date.now(), validHtml ? 'done' : 'pending').run();
 } catch (cause) {
  await access.context.bucket.delete(objectKey);
  const existing = await access.context.db.prepare('SELECT id FROM shared_stories WHERE content_hash = ? OR (ao3_work_id IS NOT NULL AND ao3_work_id = ?)').bind(hash, workId).first<{ id: string }>();
  if (existing) return Response.json({ id: existing.id, duplicate: true });
  throw cause;
 }
 return Response.json({ id, duplicate: false }, { status: 201 });
}

// A PUT carrying FormData is a regular upload, avoiding the framework's
// progressive Server Action POST body limit. The same validation applies.
export async function PUT(req: Request) { return POST(req); }

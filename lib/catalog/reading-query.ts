import type { UserCursor } from './users-query.ts';

type ReadingRow = { id: string; positionUpdatedAt: number; [key: string]: unknown };
const columns = 's.id, s.folder_id AS folderId, s.filename, s.file_type AS fileType, s.size, s.title, s.author, s.summary, s.fandom, s.relationship, s.tags, s.warnings, s.language, s.rating, s.category, s.characters, s.word_count AS wordCount, s.chapter_count AS chapterCount, s.total_chapters AS totalChapters, s.ao3_url AS ao3Url, s.created_at AS createdAt, p.location, p.updated_at AS positionUpdatedAt';

export type ReadingFilters = { q: string; rating: string; category: string; status: string };

export function parseReadingFilters(params: URLSearchParams): ReadingFilters | null {
 const filters = Object.fromEntries(['q', 'rating', 'category', 'status'].map(key => [key, (params.get(key) || '').trim().slice(0, 120)])) as ReadingFilters;
 return filters.status && !['complete', 'incomplete'].includes(filters.status) ? null : filters;
}

export async function listReadingPositions(db: D1Database, userId: string, cursor: UserCursor | null, pageSize = 50, filters: ReadingFilters = { q: '', rating: '', category: '', status: '' }) {
 const conditions = ['p.user_id = ?'];
 const values: (string | number)[] = [userId];
 const pattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
 for (const term of filters.q.split(/\s+/).filter(Boolean).slice(0, 10)) {
  conditions.push(`(${['title', 'filename', 'author', 'summary', 'fandom', 'relationship', 'tags', 'characters', 'warnings', 'category'].map(field => `s.${field} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
  values.push(...Array(10).fill(pattern(term)));
 }
 if (filters.rating) { conditions.push('TRIM(s.rating) = ?'); values.push(filters.rating); }
 if (filters.category) { conditions.push("(',' || REPLACE(COALESCE(s.category, ''), ' ', '') || ',') LIKE ? ESCAPE '\\'"); values.push(`%,${filters.category.replace(/\s/g, '').replace(/[\\%_]/g, '\\$&')},%`); }
 if (filters.status === 'complete') conditions.push('s.total_chapters IS NOT NULL AND s.chapter_count = s.total_chapters');
 if (filters.status === 'incomplete') conditions.push('s.chapter_count IS NOT NULL AND (s.total_chapters IS NULL OR s.chapter_count < s.total_chapters)');
 if (cursor) { conditions.push('(p.updated_at < ? OR (p.updated_at = ? AND s.id > ?))'); values.push(cursor.createdAt, cursor.createdAt, cursor.id); }
 const order = ' ORDER BY p.updated_at DESC, s.id ASC LIMIT ?';
 const rows = await db.prepare(`SELECT ${columns} FROM reading_positions p JOIN shared_stories s ON s.id = p.story_id WHERE ${conditions.join(' AND ')}${order}`).bind(...values, pageSize + 1).all<ReadingRow>();
 const stories = rows.results.slice(0, pageSize), last = stories.at(-1);
 return { stories, nextCursor: rows.results.length > pageSize && last ? { createdAt: last.positionUpdatedAt, id: last.id } : null };
}

export async function readingFilterOptions(db: D1Database, userId: string) {
 const rows = await db.prepare('SELECT DISTINCT s.rating, s.category FROM reading_positions p JOIN shared_stories s ON s.id = p.story_id WHERE p.user_id = ?').bind(userId).all<{ rating: string | null; category: string | null }>();
 return {
  ratings: [...new Set(rows.results.map(row => row.rating?.trim()).filter((value): value is string => !!value))].sort(),
  categories: [...new Set(rows.results.flatMap(row => (row.category || '').split(',').map(value => value.trim()).filter(Boolean)))].sort(),
 };
}

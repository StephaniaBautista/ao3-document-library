const columns = 'id, folder_id AS folderId, filename, file_type AS fileType, size, title, author, summary, fandom, relationship, tags, warnings, language, rating, category, characters, word_count AS wordCount, chapter_count AS chapterCount, total_chapters AS totalChapters, ao3_url AS ao3Url, created_at AS createdAt';

/** Validate filters before building a query; search and filters cover the shared catalog. */
export function buildStoryQuery(params: URLSearchParams) {
 const folder = params.get('folder') || null, query = (params.get('q') || '').trim().slice(0, 120);
 const filters = Object.fromEntries(['fandom', 'relationship', 'include', 'exclude', 'rating', 'category', 'characters', 'language', 'status', 'minWords', 'maxWords', 'minChapters', 'maxChapters'].map(key => [key, (params.get(key) || '').trim().slice(0, 120)]));
 const includedTags = params.getAll('include').map(value => value.trim()).filter(Boolean);
 const excludedTags = params.getAll('exclude').map(value => value.trim()).filter(Boolean);
 if (includedTags.length > 10 || excludedTags.length > 10 || [...includedTags, ...excludedTags].some(value => value.length > 120)) return { error: 'Invalid tag filters.' } as const;
 const rawOffset = params.get('offset'), rawLimit = params.get('limit');
 if (rawLimit !== null && (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) return { error: 'Invalid page size.' } as const;
 const limit = rawLimit === null ? 100 : Number(rawLimit);
 if (rawOffset !== null && (!/^\d{1,7}$/.test(rawOffset) || Number(rawOffset) > 1_000_000)) return { error: 'Invalid page offset.' } as const;
 if (filters.status && filters.status !== 'complete' && filters.status !== 'incomplete') return { error: 'Invalid story status.' } as const;
 for (const key of ['minWords', 'maxWords', 'minChapters', 'maxChapters']) if (filters[key] && !/^\d{1,10}$/.test(filters[key])) return { error: 'Invalid numeric filter.' } as const;
 const conditions: string[] = [], values: (string | number | null)[] = [];
 const pattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
 if (query) { conditions.push("(title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR fandom LIKE ? ESCAPE '\\' OR relationship LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR characters LIKE ? ESCAPE '\\')"); values.push(...Array(7).fill(pattern(query))); }
 if (filters.fandom) { conditions.push("fandom LIKE ? ESCAPE '\\'"); values.push(pattern(filters.fandom)); }
 if (filters.relationship) { conditions.push("relationship LIKE ? ESCAPE '\\'"); values.push(pattern(filters.relationship)); }
 if (filters.rating === '__unrated__') { conditions.push("(rating IS NULL OR TRIM(rating) = '' OR rating LIKE ? ESCAPE '\\')"); values.push(pattern('Not Rated')); }
 else if (filters.rating) { conditions.push("rating LIKE ? ESCAPE '\\'"); values.push(pattern(filters.rating)); }
 for (const field of ['category', 'characters', 'language'] as const) if (filters[field]) { conditions.push(`${field} LIKE ? ESCAPE '\\'`); values.push(pattern(filters[field])); }
 for (const [key, column, operator] of [['minWords', 'word_count', '>='], ['maxWords', 'word_count', '<='], ['minChapters', 'chapter_count', '>='], ['maxChapters', 'chapter_count', '<=']] as const) if (filters[key]) { conditions.push(`${column} ${operator} ?`); values.push(Number(filters[key])); }
 if (filters.status === 'complete') conditions.push('total_chapters IS NOT NULL AND chapter_count = total_chapters');
 if (filters.status === 'incomplete') conditions.push('chapter_count IS NOT NULL AND (total_chapters IS NULL OR chapter_count < total_chapters)');
 for (const tag of includedTags) { conditions.push("(tags LIKE ? ESCAPE '\\' OR warnings LIKE ? ESCAPE '\\')"); values.push(pattern(tag), pattern(tag)); }
 for (const tag of excludedTags) { conditions.push("COALESCE(tags, '') NOT LIKE ? ESCAPE '\\' AND COALESCE(warnings, '') NOT LIKE ? ESCAPE '\\'"); values.push(pattern(tag), pattern(tag)); }
 if (folder || (!query && !Object.values(filters).some(Boolean) && params.get('all') !== '1')) { conditions.push('folder_id IS ?'); values.push(folder); }
 const sorts: Record<string, string> = { title: 'title COLLATE NOCASE ASC, id ASC', author: 'author COLLATE NOCASE ASC, id ASC', recent: 'created_at DESC, id ASC', words: 'word_count DESC, id ASC', chapters: 'chapter_count DESC, id ASC' };
 const order = sorts[params.get('sort') || 'title'] || sorts.title;
 values.push(limit + 1, rawOffset === null ? 0 : Number(rawOffset));
 return { sql: `SELECT ${columns} FROM shared_stories${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ? OFFSET ?`, values, limit } as const;
}

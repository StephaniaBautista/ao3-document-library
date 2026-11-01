export type Ao3Metadata = { title?: string; rating?: string; category?: string; characters?: string; wordCount?: number; chapterCount?: number; totalChapters?: number; author?: string; summary?: string; fandom?: string; relationship?: string; tags?: string; warnings?: string; language?: string; ao3Url?: string };
export function parseAo3Header(raw: unknown): Ao3Metadata;
export function displaySummary(value: unknown, pdf?: boolean): string;

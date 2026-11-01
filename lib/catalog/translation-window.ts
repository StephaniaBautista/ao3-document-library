export type TranslationWindow = {
 segment: { position: number; translatedText: string | null; state: string } | null;
 previousPosition: number | null;
 nextPosition: number | null;
 total: number;
 completed: number;
 failed: number;
 extractionState: string;
 readingPosition: number;
};

/** Fetch a bounded reading window for the owner of the translation job. */
export async function getTranslationWindow(db: D1Database, userId: string, jobId: string, requestedPosition: number | null): Promise<TranslationWindow | null> {
 const job = await db.prepare('SELECT extraction_state AS extractionState, reading_position AS readingPosition FROM translation_jobs WHERE id = ? AND user_id = ?').bind(jobId, userId).first<{ extractionState: string; readingPosition: number }>();
 if (!job) return null;
 const target = requestedPosition ?? job.readingPosition;
 type Segment = NonNullable<TranslationWindow['segment']>;
 let segment = await db.prepare('SELECT position, translated_text AS translatedText, state FROM translation_segments WHERE job_id = ? AND position = ?').bind(jobId, target).first<Segment>();
 // During resumed extraction, wait for the saved position instead of jumping
 // backwards to an incomplete prefix and losing the user's place.
 if (!segment && job.extractionState === 'done') {
  segment = await db.prepare('SELECT position, translated_text AS translatedText, state FROM translation_segments WHERE job_id = ? AND position >= ? ORDER BY position LIMIT 1').bind(jobId, target).first<Segment>()
   ?? await db.prepare('SELECT position, translated_text AS translatedText, state FROM translation_segments WHERE job_id = ? ORDER BY position DESC LIMIT 1').bind(jobId).first<Segment>();
 }
 const counts = await db.prepare("SELECT COUNT(*) AS total, COUNT(CASE WHEN state = 'done' THEN 1 END) AS completed, COUNT(CASE WHEN state = 'failed' THEN 1 END) AS failed FROM translation_segments WHERE job_id = ?").bind(jobId).first<{ total: number; completed: number; failed: number }>();
 const neighbors = segment ? await db.prepare('SELECT (SELECT MAX(position) FROM translation_segments WHERE job_id = ? AND position < ?) AS previousPosition, (SELECT MIN(position) FROM translation_segments WHERE job_id = ? AND position > ?) AS nextPosition').bind(jobId, segment.position, jobId, segment.position).first<{ previousPosition: number | null; nextPosition: number | null }>() : null;
 return { segment, previousPosition: neighbors?.previousPosition ?? null, nextPosition: neighbors?.nextPosition ?? null, total: counts?.total ?? 0, completed: counts?.completed ?? 0, failed: counts?.failed ?? 0, extractionState: job.extractionState, readingPosition: job.readingPosition };
}

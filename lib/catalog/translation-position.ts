/** Each translation job belongs to one user, story and target language. */
export async function saveTranslationPosition(db: D1Database, userId: string, jobId: string, position: number) {
 if (!Number.isSafeInteger(position) || position < 0) return false;
 const result = await db.prepare('UPDATE translation_jobs SET reading_position = ? WHERE id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM translation_segments WHERE job_id = ? AND position = ?) RETURNING id').bind(position, jobId, userId, jobId, position).first();
 return !!result;
}

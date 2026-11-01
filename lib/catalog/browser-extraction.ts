type Segment = { position: number; text: string };

/** Only one browser may prepare a job; the previous text remains recoverable. */
export async function claimBrowserExtraction(db: D1Database, userId: string, jobId: string, now = Date.now()) {
 await requeueStaleExtractions(db, now);
 const claim = crypto.randomUUID();
 const results = await db.batch([
  db.prepare("UPDATE translation_jobs SET extraction_state = 'browser', browser_claim = ?, extraction_claimed_at = ? WHERE id = ? AND user_id = ? AND extraction_state IN ('pending', 'failed')").bind(claim, now, jobId, userId),
  db.prepare("INSERT INTO translation_browser_backups (job_id, reading_position) SELECT id, reading_position FROM translation_jobs WHERE id = ? AND user_id = ? AND extraction_state = 'browser' AND browser_claim = ?").bind(jobId, userId, claim),
  db.prepare("INSERT INTO translation_browser_backup_segments (id, job_id, position, source_text, translated_text, state, updated_at) SELECT s.id, s.job_id, s.position, s.source_text, s.translated_text, CASE WHEN s.state = 'processing' THEN 'pending' ELSE s.state END, s.updated_at FROM translation_segments s JOIN translation_jobs j ON j.id = s.job_id WHERE j.id = ? AND j.user_id = ? AND j.extraction_state = 'browser' AND j.browser_claim = ?").bind(jobId, userId, claim),
  db.prepare("DELETE FROM translation_segments WHERE job_id = ? AND EXISTS (SELECT 1 FROM translation_jobs WHERE id = ? AND user_id = ? AND extraction_state = 'browser' AND browser_claim = ?)").bind(jobId, jobId, userId, claim),
  db.prepare("UPDATE translation_jobs SET reading_position = 0 WHERE id = ? AND user_id = ? AND extraction_state = 'browser' AND browser_claim = ?").bind(jobId, userId, claim),
 ]);
 return results[0]?.meta.changes ? claim : null;
}

export async function saveBrowserSegments(db: D1Database, userId: string, jobId: string, claim: string, segments: Segment[], now = Date.now()) {
 const results = await db.batch([
  db.prepare("UPDATE translation_jobs SET extraction_claimed_at = ? WHERE id = ? AND user_id = ? AND extraction_state = 'browser' AND browser_claim = ?").bind(now, jobId, userId, claim),
  ...segments.map(segment => db.prepare("INSERT OR IGNORE INTO translation_segments (id, job_id, position, source_text, updated_at) SELECT ?, id, ?, ?, ? FROM translation_jobs WHERE id = ? AND user_id = ? AND extraction_state = 'browser' AND browser_claim = ?").bind(crypto.randomUUID(), segment.position, segment.text, now, jobId, userId, claim)),
 ]);
 return !!results[0]?.meta.changes;
}

export async function finishBrowserExtraction(db: D1Database, userId: string, jobId: string, claim: string, failed = false) {
 if (failed) {
  const results = await db.batch([
   db.prepare("DELETE FROM translation_segments WHERE job_id = ? AND EXISTS (SELECT 1 FROM translation_jobs WHERE id = ? AND user_id = ? AND extraction_state = 'browser' AND browser_claim = ?)").bind(jobId, jobId, userId, claim),
   db.prepare("INSERT INTO translation_segments (id, job_id, position, source_text, translated_text, state, updated_at) SELECT b.id, b.job_id, b.position, b.source_text, b.translated_text, b.state, b.updated_at FROM translation_browser_backup_segments b JOIN translation_jobs j ON j.id = b.job_id WHERE j.id = ? AND j.user_id = ? AND j.extraction_state = 'browser' AND j.browser_claim = ?").bind(jobId, userId, claim),
   db.prepare("UPDATE translation_jobs SET extraction_state = 'failed', extraction_claimed_at = NULL, reading_position = COALESCE((SELECT reading_position FROM translation_browser_backups WHERE job_id = translation_jobs.id), reading_position) WHERE id = ? AND user_id = ? AND extraction_state = 'browser' AND browser_claim = ?").bind(jobId, userId, claim),
   db.prepare("DELETE FROM translation_browser_backups WHERE job_id = ? AND EXISTS (SELECT 1 FROM translation_jobs WHERE id = ? AND user_id = ? AND extraction_state = 'failed' AND browser_claim = ?)").bind(jobId, jobId, userId, claim),
   db.prepare("UPDATE translation_jobs SET browser_claim = NULL WHERE id = ? AND user_id = ? AND extraction_state = 'failed' AND browser_claim = ?").bind(jobId, userId, claim),
  ]);
  return !!results[2]?.meta.changes;
 }
 const results = await db.batch([
  db.prepare("UPDATE translation_jobs SET extraction_state = 'done', extraction_claimed_at = NULL WHERE id = ? AND user_id = ? AND extraction_state = 'browser' AND browser_claim = ? AND (SELECT COUNT(*) FROM translation_segments WHERE job_id = translation_jobs.id) > 0 AND (SELECT COUNT(*) FROM translation_segments WHERE job_id = translation_jobs.id) = (SELECT MAX(position) + 1 FROM translation_segments WHERE job_id = translation_jobs.id)").bind(jobId, userId, claim),
  db.prepare("DELETE FROM translation_browser_backups WHERE job_id = ? AND EXISTS (SELECT 1 FROM translation_jobs WHERE id = ? AND user_id = ? AND extraction_state = 'done' AND browser_claim = ?)").bind(jobId, jobId, userId, claim),
  db.prepare("UPDATE translation_jobs SET browser_claim = NULL WHERE id = ? AND user_id = ? AND extraction_state = 'done' AND browser_claim = ?").bind(jobId, userId, claim),
 ]);
 return !!results[0]?.meta.changes;
}

export async function requeueStaleExtractions(db: D1Database, now = Date.now()) {
 const stale = now - 600_000;
 await db.batch([
  db.prepare("DELETE FROM translation_segments WHERE job_id IN (SELECT id FROM translation_jobs WHERE extraction_state = 'browser' AND extraction_claimed_at < ?)").bind(stale),
  db.prepare("INSERT INTO translation_segments (id, job_id, position, source_text, translated_text, state, updated_at) SELECT b.id, b.job_id, b.position, b.source_text, b.translated_text, b.state, b.updated_at FROM translation_browser_backup_segments b JOIN translation_jobs j ON j.id = b.job_id WHERE j.extraction_state = 'browser' AND j.extraction_claimed_at < ?").bind(stale),
  db.prepare("UPDATE translation_jobs SET reading_position = COALESCE((SELECT reading_position FROM translation_browser_backups WHERE job_id = translation_jobs.id), reading_position) WHERE extraction_state = 'browser' AND extraction_claimed_at < ?").bind(stale),
  db.prepare("DELETE FROM translation_browser_backups WHERE job_id IN (SELECT id FROM translation_jobs WHERE extraction_state = 'browser' AND extraction_claimed_at < ?)").bind(stale),
  db.prepare("UPDATE translation_jobs SET extraction_state = 'pending', extraction_claimed_at = NULL, browser_claim = NULL WHERE extraction_state IN ('processing', 'browser') AND extraction_claimed_at < ?").bind(stale),
 ]);
}

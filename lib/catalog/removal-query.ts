import type { UserCursor } from './users-query.ts';

type RemovalRow = { id: string; storyId: string | null; storyDescription: string; storyTitle: string | null; storyFilename: string | null; storyAuthor: string | null; storyAo3Url: string | null; proof: string; emailStatus: string | null; links: string; images: string; createdAt: number; email: string };

/** Oldest pending requests first, with a stable tie-breaker when timestamps match. */
export async function listRemovalRequests(db: D1Database, cursor: UserCursor | null, pageSize = 50) {
 const rows = cursor
  ? await db.prepare("SELECT r.id, r.story_id AS storyId, r.story_description AS storyDescription, s.title AS storyTitle, s.filename AS storyFilename, s.author AS storyAuthor, s.ao3_url AS storyAo3Url, r.proof, r.email_status AS emailStatus, r.links, (SELECT json_group_array(i.id) FROM removal_evidence_images i WHERE i.request_id = r.id) AS images, r.created_at AS createdAt, u.email FROM removal_requests r JOIN user u ON u.id = r.requester_id LEFT JOIN shared_stories s ON s.id = r.story_id WHERE r.status = 'pending' AND (r.created_at > ? OR (r.created_at = ? AND r.id > ?)) ORDER BY r.created_at ASC, r.id ASC LIMIT ?").bind(cursor.createdAt, cursor.createdAt, cursor.id, pageSize + 1).all<RemovalRow>()
  : await db.prepare("SELECT r.id, r.story_id AS storyId, r.story_description AS storyDescription, s.title AS storyTitle, s.filename AS storyFilename, s.author AS storyAuthor, s.ao3_url AS storyAo3Url, r.proof, r.email_status AS emailStatus, r.links, (SELECT json_group_array(i.id) FROM removal_evidence_images i WHERE i.request_id = r.id) AS images, r.created_at AS createdAt, u.email FROM removal_requests r JOIN user u ON u.id = r.requester_id LEFT JOIN shared_stories s ON s.id = r.story_id WHERE r.status = 'pending' ORDER BY r.created_at ASC, r.id ASC LIMIT ?").bind(pageSize + 1).all<RemovalRow>();
 const page = rows.results.slice(0, pageSize), last = page.at(-1);
 const requests = page.map(row => ({ ...row, links: JSON.parse(row.links), images: JSON.parse(row.images) }));
 return { requests, nextCursor: rows.results.length > pageSize && last ? { createdAt: last.createdAt, id: last.id } : null };
}

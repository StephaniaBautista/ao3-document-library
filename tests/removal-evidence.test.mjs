import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { evidenceImageType, parseEvidenceLinks, readEvidenceBody, MAX_EVIDENCE_BODY_BYTES } from '../lib/catalog/removal-evidence.ts';

test('evidence links allow only bounded HTTP(S) URLs without credentials', () => {
 assert.deepEqual(parseEvidenceLinks(['https://example.com/proof', 'http://example.org/a']), ['https://example.com/proof', 'http://example.org/a']);
 for (const links of [['javascript:alert(1)'], ['https://user:pass@example.com'], ['not a link'], Array(6).fill('https://example.com')]) assert.equal(parseEvidenceLinks(links), null);
});

test('evidence images are identified by their bytes', () => {
 assert.equal(evidenceImageType(Uint8Array.from([137,80,78,71,13,10,26,10])), 'image/png');
 assert.equal(evidenceImageType(Uint8Array.from([255,216,255,0])), 'image/jpeg');
 assert.equal(evidenceImageType(new TextEncoder().encode('RIFF1234WEBP')), 'image/webp');
 assert.equal(evidenceImageType(new TextEncoder().encode('<svg>')), null);
});

test('request body is bounded even without a content-length header', async () => {
 const request = new Request('https://example.com', { method: 'POST', body: new Uint8Array(MAX_EVIDENCE_BODY_BYTES + 1) });
 assert.equal(await readEvidenceBody(request), null);
});

test('images are removed with their request or requester and old requests retain defaults', () => {
 const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON');
 const directory = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(name, directory), 'utf8'));
 try {
  db.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','User','u@example.invalid',1,1,1);
  const insert = db.prepare('INSERT INTO removal_requests (id,requester_id,story_description,proof,created_at) VALUES (?,?,?,?,?)');
  insert.run('r1','u','Story','Old proof',1); insert.run('r2','u','Story','',2);
  assert.equal(db.prepare('SELECT links FROM removal_requests WHERE id = ?').get('r1').links, '[]');
  const image = db.prepare('INSERT INTO removal_evidence_images (id,request_id,content_type,data) VALUES (?,?,?,?)');
  image.run('i1','r1','image/png',Uint8Array.of(1)); image.run('i2','r2','image/png',Uint8Array.of(2));
  db.prepare('DELETE FROM removal_requests WHERE id = ?').run('r1');
  assert.equal(db.prepare('SELECT count(*) AS n FROM removal_evidence_images').get().n, 1);
  db.prepare('DELETE FROM user WHERE id = ?').run('u');
  assert.equal(db.prepare('SELECT count(*) AS n FROM removal_evidence_images').get().n, 0);
 } finally { db.close(); }
});

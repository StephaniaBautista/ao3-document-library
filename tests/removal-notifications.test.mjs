import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { sendRemovalNotification, processRemovalNotifications } from '../lib/catalog/removal-notifications.ts';

function setup() {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const dir = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, dir), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','User','reader@example.test',1,1,1);
 raw.prepare('INSERT INTO removal_requests (id,requester_id,story_description,proof,links,email_status,created_at) VALUES (?,?,?,?,?,?,?)').run('r','u','Story <X>','Test <proof>',JSON.stringify(['https://example.test/?a=1&b=2']),'pending',1);
 raw.prepare('INSERT INTO removal_evidence_images (id,request_id,content_type,data) VALUES (?,?,?,?)').run('i','r','image/png',Uint8Array.from([1,2,3]));
 const db = { prepare: sql => ({ bind: (...values) => ({ first: async () => raw.prepare(sql).get(...values) || null, run: async () => raw.prepare(sql).run(...values), all: async () => ({ results: raw.prepare(sql).all(...values) }) }), all: async () => ({ results: raw.prepare(sql).all() }) }) };
 return { raw, env: { DB: db, REMOVAL_REQUEST_EMAIL: 'owner@example.test', BREVO_API_KEY: 'key', BREVO_FROM_EMAIL: 'sender@example.test' } };
}

test('a saved request sends its explanation, links and image exactly once', async () => {
 const { raw, env } = setup(), original = globalThis.fetch; let count = 0;
 globalThis.fetch = async (_url, init) => { count++; const body = JSON.parse(init.body); assert.equal(body.to[0].email,'owner@example.test'); assert.match(body.textContent, /reader@example.test/); assert.match(body.textContent, /https:\/\/example.test/); assert.match(body.htmlContent, /Story &lt;X&gt;/); assert.match(body.htmlContent, /Test &lt;proof&gt;/); assert.deepEqual(body.attachment,[{ name:'evidence-1.png',content:'AQID' }]); return Response.json({ messageId:'id' }); };
 try { assert.equal(await sendRemovalNotification(env,'r'),'sent'); assert.equal(await sendRemovalNotification(env,'r'),'unchanged'); assert.equal(count,1); assert.equal(raw.prepare('SELECT email_status FROM removal_requests').get().email_status,'sent'); } finally { globalThis.fetch = original; raw.close(); }
});

test('ambiguous provider results are not retried, while absent configuration leaves a request pending', async () => {
 const { raw, env } = setup(), original = globalThis.fetch; let count=0;
 globalThis.fetch = async () => { count++; throw new Error('timeout'); };
 try { assert.equal(await sendRemovalNotification({ ...env, REMOVAL_REQUEST_EMAIL: '' }, 'r'),'pending'); assert.equal(await sendRemovalNotification(env,'r'),'unknown'); await processRemovalNotifications(env); assert.equal(count,1); assert.equal(raw.prepare('SELECT email_status FROM removal_requests').get().email_status,'unknown'); } finally { globalThis.fetch = original; raw.close(); }
});

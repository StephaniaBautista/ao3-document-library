import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sendRecoveryNotifications } from '../lib/catalog/ao3-notifications.ts';
import { checkAo3AndNotify } from '../lib/catalog/ao3-scheduler.ts';
import { checkAo3 } from '../lib/catalog/ao3-monitor.ts';
import { nextAo3State } from '../lib/catalog/ao3-state.mjs';

function fixture() {
 const raw = new DatabaseSync(':memory:');
 raw.exec('PRAGMA foreign_keys = ON');
 for (const name of ['0000_lush_magdalene.sql', '0001_tough_stephen_strange.sql', '0002_high_power_pack.sql', '0003_gigantic_jigsaw.sql', '0004_busy_tattoo.sql', '0005_volatile_blackheart.sql', '0006_far_dazzler.sql', '0007_messy_tarot.sql', '0008_certain_maddog.sql', '0009_slow_ozymandias.sql', '0010_shallow_tusk.sql', '0011_lazy_ma_gnuci.sql', '0012_lumpy_blue_blade.sql', '0013_silky_doomsday.sql', '0014_perfect_ravenous.sql', '0015_low_drax.sql', '0016_polite_human_fly.sql', '0017_grey_fat_cobra.sql', '0018_sharp_blockbuster.sql', '0019_amused_bishop.sql', '0020_left_human_fly.sql', '0021_nebulous_secret_warriors.sql', '0022_sweet_madame_hydra.sql', '0023_brave_overlord.sql', '0024_spotty_barracuda.sql', '0025_flimsy_victor_mancha.sql', '0026_early_mentallo.sql', '0027_married_mojo.sql', '0028_slow_xorn.sql', '0029_round_imperial_guard.sql', '0030_mute_raza.sql', '0031_ordinary_tusk.sql', '0032_fearless_alex_power.sql']) raw.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'));
 raw.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('u', 'User', 'test@example.com', 1, 1, 1);
 raw.prepare('INSERT INTO library_profiles (user_id, age_verified, created_at) VALUES (?, ?, ?)').run('u', 1, 1);
 raw.prepare('INSERT INTO shared_stories (id, filename, file_type, size, object_key, content_hash, title, ao3_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('s', 's.pdf', 'pdf', 1, 'key', 'hash', 'A story', 'https://archiveofourown.org/works/123', 1);
 raw.prepare('INSERT INTO reminders (id, user_id, story_id, action, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('r', 'u', 's', 'comment', 'Thank you for this story', 1);
 raw.prepare('INSERT INTO ao3_status (id,state,consecutive_successes,consecutive_failures,last_checked_at,recovered_at,last_observation) VALUES (?,?,?,?,?,?,?)').run('ao3','up',2,0,Date.now(),100,'success');
 function prepare(sql) {
  function statement(values) {
   return { bind: (...next) => statement(next), run: async () => raw.prepare(sql).run(...values), first: async () => raw.prepare(sql).get(...values) ?? null, all: async () => ({ results: raw.prepare(sql).all(...values) }), execute: () => raw.prepare(sql).run(...values) };
  }
  return statement([]);
 }
 const db = { prepare, batch: async statements => { raw.exec('BEGIN'); try { for (const statement of statements) statement.execute(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; } } };
 return { raw, env: { DB: db, POSTMARK_SERVER_TOKEN: 'test', POSTMARK_FROM_EMAIL: 'test@example.com' } };
}

test('accepted recovery email includes the private comment and consumes the reminder exactly once', async () => {
 const { raw, env } = fixture(); const original = globalThis.fetch; const messages = [];
 raw.prepare('UPDATE reminders SET comment = ? WHERE id = ?').run('Thank you for this story\nIt meant a lot.', 'r');
 globalThis.fetch = async (_url, init) => { assert.equal(init.redirect, 'manual'); messages.push(JSON.parse(init.body)); return Response.json({ ErrorCode: 0, MessageID: 'test-message' }); };
 try {
  await sendRecoveryNotifications(env, 100);
  await sendRecoveryNotifications(env, 100);
  assert.equal(messages.length, 1);
  assert.match(messages[0].TextBody, /AO3 is back/);
  assert.match(messages[0].TextBody, /A story\nhttps:\/\/archiveofourown\.org\/works\/123\nYour comment to post on AO3:\nThank you for this story\nIt meant a lot\./);
  assert.match(messages[0].HtmlBody, /href="https:\/\/archiveofourown\.org\/works\/123"/);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM reminders').get().n, 0);
  assert.equal(raw.prepare('SELECT state FROM notification_batches').get().state, 'sent');
 } finally { globalThis.fetch = original; raw.close(); }
});

test('one email groups kudos and comments by story and escapes untrusted content', async () => {
 const { raw, env } = fixture(); const original = globalThis.fetch; const messages = [];
 raw.prepare('UPDATE reminders SET comment = ? WHERE id = ?').run('<script>bad()</script>\nThanks!', 'r');
 raw.prepare('INSERT INTO reminders (id,user_id,story_id,action,comment,created_at) VALUES (?,?,?,?,?,?)').run('k','u','s','kudo',null,2);
 raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,ao3_url,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('s2','s2.pdf','pdf',1,'key2','hash2','Other <story>','https://evil.example/works/99',1);
 raw.prepare('INSERT INTO reminders (id,user_id,story_id,action,comment,created_at) VALUES (?,?,?,?,?,?)').run('k2','u','s2','kudo',null,3);
 globalThis.fetch = async (_url, init) => { messages.push(JSON.parse(init.body)); return Response.json({ ErrorCode: 0, MessageID: 'test' }); };
 try {
  await sendRecoveryNotifications(env, 100);
  assert.equal(messages.length, 1);
  assert.equal((messages[0].TextBody.match(/A story/g) || []).length, 1);
  assert.match(messages[0].TextBody, /Leave kudos/);
  assert.match(messages[0].TextBody, /<script>bad\(\)<\/script>\nThanks!/);
  assert.match(messages[0].HtmlBody, /&lt;script&gt;bad\(\)&lt;\/script&gt;<br>Thanks!/);
  assert.match(messages[0].HtmlBody, /Other &lt;story&gt;/);
  assert.doesNotMatch(messages[0].HtmlBody, /evil\.example|<script>/);
  assert.match(messages[0].HtmlBody, /AO3 link unavailable/);
 } finally { globalThis.fetch = original; raw.close(); }
});

test('Brevo recovery email includes reminders and remains pending when rate limited', async () => {
 const { raw, env } = fixture(); const original = globalThis.fetch; const messages = [];
 Object.assign(env, { BREVO_API_KEY: 'test', BREVO_FROM_EMAIL: 'sender@example.test' });
 globalThis.fetch = async (url, init) => { assert.equal(url, 'https://api.brevo.com/v3/smtp/email'); messages.push(JSON.parse(init.body)); return new Response(null, { status: 429 }); };
 try {
  await sendRecoveryNotifications(env, 100);
  assert.equal(messages.length, 1);
  assert.match(messages[0].textContent, /Thank you for this story/);
  assert.match(messages[0].htmlContent, /archiveofourown.org\/works\/123/);
  assert.equal(raw.prepare('SELECT state FROM notification_batches').get().state, 'pending');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM reminders').get().n, 1);
  globalThis.fetch = async () => Response.json({ messageId: '<test@brevo.test>' }, { status: 201 });
  await sendRecoveryNotifications(env, 100);
  assert.equal(raw.prepare('SELECT state FROM notification_batches').get().state, 'sent');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM reminders').get().n, 0);
 } finally { globalThis.fetch = original; raw.close(); }
});

test('a redirect from the mail provider is not followed or retried as a new email', async () => {
 const { raw, env } = fixture(); const original = globalThis.fetch; let attempts = 0;
 globalThis.fetch = async (_url, init) => { assert.equal(init.redirect, 'manual'); attempts++; return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } }); };
 try {
  await sendRecoveryNotifications(env, 100);
  await sendRecoveryNotifications(env, 200);
  assert.equal(attempts, 1);
  assert.equal(raw.prepare('SELECT state FROM notification_batches').get().state, 'unknown');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM reminders').get().n, 1);
 } finally { globalThis.fetch = original; raw.close(); }
});

test('unknown provider outcome does not retry or erase the reminder on a later recovery', async () => {
 const { raw, env } = fixture(); const original = globalThis.fetch; let attempts = 0;
 globalThis.fetch = async () => { attempts++; throw new Error('network timeout'); };
 try {
  await sendRecoveryNotifications(env, 100);
  await sendRecoveryNotifications(env, 200);
  assert.equal(attempts, 1);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM reminders').get().n, 1);
  assert.equal(raw.prepare('SELECT state FROM notification_batches').get().state, 'unknown');
 } finally { globalThis.fetch = original; raw.close(); }
});

test('a blocked account does not receive an already queued recovery notification', async () => {
 const { raw, env } = fixture(); const original = globalThis.fetch; let attempts = 0;
 raw.prepare('INSERT INTO notification_batches (id, user_id, recovery_at, state, created_at) VALUES (?, ?, ?, ?, ?)').run('batch', 'u', 100, 'pending', 10);
 raw.prepare('INSERT INTO notification_items (id, batch_id, reminder_id) VALUES (?, ?, ?)').run('item', 'batch', 'r');
 raw.prepare('UPDATE library_profiles SET blocked = 1 WHERE user_id = ?').run('u');
 globalThis.fetch = async () => { attempts++; return Response.json({ ErrorCode: 0, MessageID: 'test-message' }); };
 try {
  await sendRecoveryNotifications(env, 100);
  assert.equal(attempts, 0);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM reminders').get().n, 1);
  assert.equal(raw.prepare('SELECT state FROM notification_batches WHERE id = ?').get('batch').state, 'failed');
 } finally { globalThis.fetch = original; raw.close(); }
});

test('pending notifications wait through failure and uncertainty until AO3 is confirmed available again', async () => {
 const { raw, env } = fixture(); const original = globalThis.fetch; const statuses = [503, 403, 200, 200, 200]; let emails = 0;
 raw.prepare('UPDATE ao3_status SET last_checked_at = 1 WHERE id = ?').run('ao3');
 globalThis.fetch = async input => {
  if (String(input).startsWith('https://archiveofourown.org/')) return new Response(null, { status:statuses.shift() });
  assert.equal(String(input), 'https://api.postmarkapp.com/email'); emails++;
  return Response.json({ ErrorCode:0, MessageID:'synthetic' });
 };
 try {
  for (let i = 0; i < 3; i++) { await checkAo3AndNotify(env); assert.equal(emails, 0); }
  assert.equal(raw.prepare('SELECT count(*) AS n FROM reminders').get().n, 1);
  await checkAo3AndNotify(env); assert.equal(emails, 1);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM reminders').get().n, 0);
  await checkAo3AndNotify(env); assert.equal(emails, 1);
 } finally { globalThis.fetch = original; raw.close(); }
});

test('a new uncertain observation pauses the queue between recipients without consuming their reminders', async () => {
 const { raw, env } = fixture(); const original = globalThis.fetch; let emails = 0;
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u2','User 2','u2@example.invalid',1,1,1);
 raw.prepare('INSERT INTO library_profiles (user_id,age_verified,created_at) VALUES (?,?,?)').run('u2',1,1);
 raw.prepare('INSERT INTO reminders (id,user_id,story_id,action,comment,created_at) VALUES (?,?,?,?,?,?)').run('r2','u2','s','comment','Second comment',1);
 globalThis.fetch = async () => {
  emails++;
  if (emails === 1) raw.prepare("UPDATE ao3_status SET last_observation = 'failure', consecutive_successes = 0, consecutive_failures = 1 WHERE id = 'ao3'").run();
  return Response.json({ ErrorCode:0, MessageID:`synthetic-${emails}` });
 };
 try {
  await sendRecoveryNotifications(env, 100);
  assert.equal(emails, 1);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM reminders').get().n, 1);
  assert.equal(raw.prepare("SELECT count(*) AS n FROM notification_batches WHERE state = 'pending'").get().n, 1);
  raw.prepare("UPDATE ao3_status SET last_observation = 'success', consecutive_successes = 2, consecutive_failures = 0, last_checked_at = ? WHERE id = 'ao3'").run(Date.now());
  await sendRecoveryNotifications(env, 100);
  assert.equal(emails, 2); assert.equal(raw.prepare('SELECT count(*) AS n FROM reminders').get().n, 0);
 } finally { globalThis.fetch = original; raw.close(); }
});

test('stored transitions agree with the status rules across failures, uncertainty, and recovery', async () => {
 const { raw, env } = fixture(); const original = globalThis.fetch;
 const statuses = [200, 200, 503, 403, 503, 503, 200, 200, 200];
 raw.prepare("DELETE FROM ao3_status WHERE id = 'ao3'").run();
 let expected = null;
 try {
  for (const status of statuses) {
   globalThis.fetch = async () => new Response(null, { status });
   const actual = await checkAo3(env.DB);
   const observation = status === 200 ? 'success' : status === 503 ? 'failure' : 'uncertain';
   expected = nextAo3State(expected, observation, actual.lastCheckedAt);
   assert.deepEqual({ ...actual }, expected);
  }
 } finally { globalThis.fetch = original; raw.close(); }
});

test('overlapping checks each apply their observation without losing a transition', async () => {
 const { raw, env } = fixture(); const original = globalThis.fetch;
 try {
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await Promise.all([checkAo3(env.DB), checkAo3(env.DB)]);
  const failed = raw.prepare("SELECT state, consecutive_failures FROM ao3_status WHERE id = 'ao3'").get();
  assert.equal(failed.state, 'down'); assert.equal(failed.consecutive_failures, 2);
  globalThis.fetch = async () => new Response(null, { status: 200 });
  await Promise.all([checkAo3(env.DB), checkAo3(env.DB)]);
  const recovered = raw.prepare("SELECT state, consecutive_successes, recovered_at FROM ao3_status WHERE id = 'ao3'").get();
  assert.equal(recovered.state, 'up'); assert.equal(recovered.consecutive_successes, 2); assert.ok(recovered.recovered_at > 100);
 } finally { globalThis.fetch = original; raw.close(); }
});

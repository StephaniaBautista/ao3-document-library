import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fandomFolder } from '../lib/catalog/fandom-folder.ts';

test('reuses an existing fandom, creates a new one, and leaves ambiguous matches unfiled', async () => {
 const raw = new DatabaseSync(':memory:');
 raw.exec('CREATE TABLE shared_folders (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT, created_at INTEGER)');
 raw.prepare('INSERT INTO shared_folders VALUES (?,NULL,?,?)').run('supergirl', 'Supergirl', 1);
 const db = { prepare(sql: string) { return { bind(...values: unknown[]) { return {
  async all() { return { results: raw.prepare(sql).all(...values as string[]) }; },
  async first() { return raw.prepare(sql).get(...values as string[]) || null; },
  async run() { return raw.prepare(sql).run(...values as string[]); },
 }; } , async all() { return { results: raw.prepare(sql).all() }; } }; } } as unknown as D1Database;
 try {
  assert.equal(await fandomFolder(db, 'Supergirl (TV 2015)'), 'supergirl');
  const newId = await fandomFolder(db, 'The 100');
  assert.ok(newId);
  assert.equal(await fandomFolder(db, 'the 100'), newId);
  raw.prepare('INSERT INTO shared_folders VALUES (?,NULL,?,?)').run('other', 'Supergirl (Comics)', 1);
  assert.equal(await fandomFolder(db, 'Supergirl (Movie)'), null);
  assert.equal(await fandomFolder(db, null), null);
 } finally { raw.close(); }
});

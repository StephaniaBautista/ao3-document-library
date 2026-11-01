import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

function database() {
 const db = new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys = ON');
 for (const migration of ['0000_lush_magdalene.sql', '0001_tough_stephen_strange.sql', '0002_high_power_pack.sql', '0003_gigantic_jigsaw.sql', '0004_busy_tattoo.sql', '0005_volatile_blackheart.sql', '0006_far_dazzler.sql', '0007_messy_tarot.sql', '0008_certain_maddog.sql', '0009_slow_ozymandias.sql', '0010_shallow_tusk.sql', '0011_lazy_ma_gnuci.sql', '0012_lumpy_blue_blade.sql', '0013_silky_doomsday.sql', '0014_perfect_ravenous.sql', '0015_low_drax.sql', '0016_polite_human_fly.sql', '0017_grey_fat_cobra.sql', '0018_sharp_blockbuster.sql', '0019_amused_bishop.sql', '0020_left_human_fly.sql', '0021_nebulous_secret_warriors.sql', '0022_sweet_madame_hydra.sql', '0023_brave_overlord.sql', '0024_spotty_barracuda.sql', '0025_flimsy_victor_mancha.sql', '0026_early_mentallo.sql', '0027_married_mojo.sql', '0028_slow_xorn.sql', '0029_round_imperial_guard.sql', '0030_mute_raza.sql', '0031_ordinary_tusk.sql', '0032_fearless_alex_power.sql']) {
  db.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'));
 }
 return db;
}

test('deleting an account preserves shared stories while removing identifying ownership and profile', () => {
 const db = database();
 db.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('user-1', 'A', 'a@example.com', 1, 1, 1);
 db.prepare('INSERT INTO library_profiles (user_id, age_verified, created_at) VALUES (?, ?, ?)').run('user-1', 1, 1);
 db.prepare('INSERT INTO shared_stories (id, submitted_by, filename, file_type, size, object_key, content_hash, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('story-1', 'user-1', 'story.pdf', 'pdf', 10, 'catalog/1', 'hash-1', 'Story', 1);
 db.prepare('DELETE FROM user WHERE id = ?').run('user-1');
 assert.equal(db.prepare('SELECT submitted_by FROM shared_stories WHERE id = ?').get('story-1').submitted_by, null);
 assert.equal(db.prepare('SELECT count(*) AS count FROM library_profiles').get().count, 0);
 db.close();
});

test('the catalog rejects duplicate original bytes and duplicate AO3 work ids', () => {
 const db = database();
 const insert = db.prepare('INSERT INTO shared_stories (id, filename, file_type, size, object_key, content_hash, title, ao3_work_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
 insert.run('1', 'one.pdf', 'pdf', 1, 'catalog/1', 'hash', 'One', '123', 1);
 assert.throws(() => insert.run('2', 'two.pdf', 'pdf', 1, 'catalog/2', 'hash', 'Two', null, 1), /UNIQUE/);
 assert.throws(() => insert.run('3', 'three.pdf', 'pdf', 1, 'catalog/3', 'other', 'Three', '123', 1), /UNIQUE/);
 db.close();
});

test('the migration preserves the pre-existing private library tables', () => {
 const db = database();
 db.prepare('INSERT INTO folders (id, owner, name, created_at) VALUES (?, ?, ?, ?)').run('private-folder', 'legacy', 'Private', 1);
 db.prepare('INSERT INTO files (id, owner, folder_id, name, type, size, object_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('private-file', 'legacy', 'private-folder', 'private.pdf', 'pdf', 1, 'private/key', 1);
 assert.equal(db.prepare('SELECT owner FROM files WHERE id = ?').get('private-file').owner, 'legacy');
 db.close();
});

test('favorites are unique per collection and erased when the owner deletes their account', () => {
 const db = database();
 db.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('u', 'A', 'u@example.com', 1, 1, 1);
 db.prepare('INSERT INTO shared_stories (id, filename, file_type, size, object_key, content_hash, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('s', 's.pdf', 'pdf', 1, 'key', 'hash', 'Story', 1);
 db.prepare('INSERT INTO favorite_collections VALUES (?, ?, ?, ?)').run('c', 'u', 'Favorites', 1);
 const add = db.prepare('INSERT INTO favorite_items VALUES (?, ?, ?, ?)');
 add.run('i', 'c', 's', 1);
 assert.throws(() => add.run('i2', 'c', 's', 1), /UNIQUE/);
 db.prepare('DELETE FROM user WHERE id = ?').run('u');
 assert.equal(db.prepare('SELECT count(*) AS count FROM favorite_items').get().count, 0);
 assert.equal(db.prepare('SELECT count(*) AS count FROM shared_stories').get().count, 1);
 db.close();
});

test('folder names are unique among siblings, including the root', () => {
 const db = database();
 const insert = db.prepare('INSERT INTO shared_folders (id, parent_id, name, created_at) VALUES (?, ?, ?, ?)');
 insert.run('one', null, 'Fandom', 1);
 assert.throws(() => insert.run('two', null, 'fandom', 1), /UNIQUE/);
 insert.run('child', 'one', 'Pair', 1);
 assert.throws(() => insert.run('child2', 'one', 'pair', 1), /UNIQUE/);
 db.close();
});

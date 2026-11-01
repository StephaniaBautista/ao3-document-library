import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { deleteEmptyFolder } from '../lib/catalog/folder-delete.ts';
import { listDriveDuplicates } from '../lib/catalog/drive-duplicates.ts';

function fixture() {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const dir = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, dir), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','User','u@example.invalid',1,1,1);
 raw.prepare('INSERT INTO drive_import_jobs (id,user_id,created_at) VALUES (?,?,?)').run('j','u',1);
 const folder = raw.prepare('INSERT INTO shared_folders (id,parent_id,name,created_at) VALUES (?,?,?,?)');
 folder.run('root',null,'Fandom',1); folder.run('removed','root','Pair',1); folder.run('kept','root','Other',1);
 raw.prepare('INSERT INTO shared_stories (id,folder_id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('s','kept','fic.pdf','pdf',1,'key','hash','Story',1);
 const add = raw.prepare('INSERT INTO drive_import_items (id,job_id,drive_id,name,mime_type,parent_item_id,parent_folder_id,catalog_folder_id,story_id,duplicate,state,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
 add.run('root-item','j','root','Fandom','application/vnd.google-apps.folder',null,null,'root',null,0,'done',1);
 add.run('pair-item','j','pair','Pair','application/vnd.google-apps.folder','root-item','root','removed',null,0,'done',1);
 add.run('copy','j','copy','fic.pdf','application/pdf','pair-item','removed',null,'s',1,'done',1);
 function prepare(sql) { function bound(values) { return { bind: (...args)=>bound(args), all: async()=>({results:raw.prepare(sql).all(...values)}), execute:()=>({meta:{changes:raw.prepare(sql).run(...values).changes}}) }; } return bound([]); }
 const db={prepare,batch:async statements=>{raw.exec('BEGIN');try{const result=statements.map(s=>s.execute());raw.exec('COMMIT');return result;}catch(error){raw.exec('ROLLBACK');throw error;}}};
 return {raw,db};
}

test('completed import references do not prevent deleting an empty folder or erase its source path', async () => {
 const {raw,db}=fixture();
 try {
  assert.equal(await deleteEmptyFolder(db,'removed'),true);
  assert.equal(raw.prepare('SELECT id FROM shared_folders WHERE id = ?').get('removed'),undefined);
  assert.equal(raw.prepare('SELECT parent_folder_id FROM drive_import_items WHERE id = ?').get('copy').parent_folder_id,null);
  assert.equal(raw.prepare('SELECT catalog_folder_id FROM drive_import_items WHERE id = ?').get('pair-item').catalog_folder_id,null);
  const review=await listDriveDuplicates(db,'j',null);
  assert.equal(review.duplicates[0].sourcePath,'Fandom / Pair / fic.pdf');
  assert.equal(review.duplicates[0].sourceFolderAvailable,false);
  assert.equal(review.duplicates[0].currentFolderPath,'Fandom / Other');
 } finally {raw.close();}
});

test('an active import, a child, or a story prevents deletion without detaching references', async () => {
 for (const blocker of ['pending','processing','child','story']) {
  const {raw,db}=fixture();
  try {
   if (blocker === 'child') raw.prepare('INSERT INTO shared_folders (id,parent_id,name,created_at) VALUES (?,?,?,?)').run('child','removed','Child',1);
   else if (blocker === 'story') raw.prepare('UPDATE shared_stories SET folder_id = ? WHERE id = ?').run('removed','s');
   else raw.prepare('UPDATE drive_import_items SET state = ? WHERE id = ?').run(blocker,'copy');
   assert.equal(await deleteEmptyFolder(db,'removed'),false);
   assert.ok(raw.prepare('SELECT id FROM shared_folders WHERE id = ?').get('removed'));
   assert.equal(raw.prepare('SELECT parent_folder_id FROM drive_import_items WHERE id = ?').get('copy').parent_folder_id,'removed');
  } finally {raw.close();}
 }
});

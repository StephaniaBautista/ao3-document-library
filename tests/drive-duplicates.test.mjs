import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { listDriveDuplicates } from '../lib/catalog/drive-duplicates.ts';

test('duplicate locations across an owner’s imports are paginated and keep their own folder paths', async () => {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const dir = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(name, dir), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','User','u@example.invalid',1,1,1);
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('other-user','Other','other@example.invalid',1,1,1);
 raw.prepare('INSERT INTO drive_import_jobs (id,user_id,created_at) VALUES (?,?,?)').run('j','u',1);
 raw.prepare('INSERT INTO drive_import_jobs (id,user_id,created_at) VALUES (?,?,?)').run('other','u',2);
 raw.prepare('INSERT INTO drive_import_jobs (id,user_id,created_at) VALUES (?,?,?)').run('foreign','other-user',3);
 raw.prepare('INSERT INTO shared_folders (id,parent_id,name,created_at) VALUES (?,?,?,?)').run('folder',null,'Fandom',1);
 raw.prepare('INSERT INTO shared_stories (id,folder_id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('s','folder','fic.pdf','pdf',1,'key','hash','Story',1);
 raw.prepare('INSERT INTO shared_stories (id,folder_id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('single','folder','single.pdf','pdf',1,'key2','hash2','Single',1);
 const add = raw.prepare('INSERT INTO drive_import_items (id,job_id,drive_id,name,mime_type,parent_item_id,parent_folder_id,story_id,duplicate,state,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
 add.run('root','j','folder','Fandom','application/vnd.google-apps.folder',null,null,null,0,'done',1);
 for (let i=0;i<121;i++) add.run(`item-${String(i).padStart(3,'0')}`,'j',`drive-${i}`,`file-${i}.pdf`,'application/pdf','root','folder','s',i===0?0:1,'done',1);
 add.run('other-root','other','other-folder','Otra carpeta','application/vnd.google-apps.folder',null,null,null,0,'done',1);
 add.run('other-item','other','other','other.pdf','application/pdf','other-root','folder','s',1,'done',1);
 add.run('single-item','j','single','single.pdf','application/pdf','root','folder','single',0,'done',1);
 add.run('foreign-item','foreign','foreign','foreign.pdf','application/pdf',null,'folder','s',1,'done',1);
 add.run('foreign-single','foreign','foreign2','foreign-single.pdf','application/pdf',null,'folder','single',1,'done',1);
 const db = { prepare: sql => ({ bind: (...values) => ({ all: async () => ({ results: raw.prepare(sql).all(...values) }) }) }) };
 try {
  const seen=[]; let cursor=null;
  do { const page=await listDriveDuplicates(db,'j',cursor); seen.push(...page.duplicates); cursor=page.nextDuplicateCursor; } while(cursor);
  assert.equal(seen.length,122); assert.equal(new Set(seen.map(item=>item.id)).size,122);
  assert.ok(seen.some(item=>item.id==='item-000')); assert.ok(seen.some(item=>item.id==='other-item'));
  assert.ok(!seen.some(item=>item.id.startsWith('foreign') || item.id==='single-item'));
  assert.ok(seen.filter(item=>item.id!=='other-item').every(item=>item.sourcePath.startsWith('Fandom / ') && item.currentFolderPath==='Fandom' && item.sourceImportCreatedAt===1));
  assert.equal(seen.find(item=>item.id==='other-item').sourcePath,'Otra carpeta / other.pdf');
  assert.equal(seen.find(item=>item.id==='other-item').sourceImportCreatedAt,2);
  const fromOther=[]; cursor=null;
  do { const page=await listDriveDuplicates(db,'other',cursor); fromOther.push(...page.duplicates); cursor=page.nextDuplicateCursor; } while(cursor);
  assert.equal(fromOther.length,122); assert.ok(fromOther.some(item=>item.id==='item-000'));
 } finally { raw.close(); }
});

test('migration links existing retained imports without inventing duplicate matches', () => {
 const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
 const dir = new URL('../drizzle/', import.meta.url);
 for (const name of readdirSync(dir).filter(name => name.endsWith('.sql') && name.slice(0, 4) < '0032').sort()) raw.exec(readFileSync(new URL(name, dir), 'utf8'));
 raw.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('u','User','u@example.invalid',1,1,1);
 raw.prepare('INSERT INTO drive_import_jobs (id,user_id,created_at) VALUES (?,?,?)').run('j','u',1);
 raw.prepare('INSERT INTO shared_stories (id,filename,file_type,size,object_key,content_hash,title,created_at) VALUES (?,?,?,?,?,?,?,?)').run('retained','fic.pdf','pdf',1,'key','hash','Story',1);
 const add = raw.prepare('INSERT INTO drive_import_items (id,job_id,drive_id,name,mime_type,state,updated_at) VALUES (?,?,?,?,?,?,?)');
 add.run('retained','j','file','fic.pdf','application/pdf','done',1);
 add.run('unknown','j','copy','copy.pdf','application/pdf','done',1);
 try {
  raw.exec(readFileSync(new URL('0032_fearless_alex_power.sql',dir),'utf8'));
  const rows=raw.prepare('SELECT id,story_id,duplicate FROM drive_import_items ORDER BY id').all();
  assert.deepEqual(rows.map(row=>[row.id,row.story_id,row.duplicate]),[['retained','retained',0],['unknown',null,0]]);
  raw.prepare('DELETE FROM shared_stories WHERE id = ?').run('retained');
  assert.equal(raw.prepare('SELECT story_id FROM drive_import_items WHERE id = ?').get('retained').story_id,null);
 } finally { raw.close(); }
});

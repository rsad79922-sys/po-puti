import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {writeFile,readFile,symlink,unlink,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isolatedServer} from './helpers/server.mjs';
import {accountPrivacy} from '../server/account-privacy.mjs';
const app=await isolatedServer();app.child.kill('SIGTERM');await new Promise(resolve=>app.child.once('exit',resolve));let db;
try{
 db=new DatabaseSync(app.dir+'/po-puti.sqlite');db.exec('PRAGMA foreign_keys=ON');
 const ids=Array.from({length:4},()=>randomUUID());
 for(const id of ids)db.prepare("INSERT INTO users(id,username,salt,hash,name,created) VALUES(?,?, 'x','x','Fixture',?)").run(id,id,Date.now());
 const privacy=await accountPrivacy(db,app.dir),[faulted,mediaOwner,sharedOwner,peer]=ids;
 db.exec(`CREATE TRIGGER simulate_write_failure BEFORE UPDATE ON users WHEN OLD.id='${faulted}' BEGIN SELECT RAISE(ABORT,'Isolated failure'); END;`);
 await assert.rejects(privacy.erase(faulted),/Isolated failure/);assert.equal(privacy.isUnavailable(faulted),true,'durable intent blocks access even if SQL transaction rolled back');assert.equal(db.prepare('SELECT COUNT(*) n FROM account_deletions').get().n,0);assert.equal(db.prepare('SELECT name FROM users WHERE id=?').get(faulted).name,'Fixture');
 db.exec('DROP TRIGGER simulate_write_failure');
 // New process/connection completes the durable intent, no broad table cleanup.
 db.close();db=new DatabaseSync(app.dir+'/po-puti.sqlite');db.exec('PRAGMA foreign_keys=ON');const recovered=await accountPrivacy(db,app.dir);assert.equal(db.prepare('SELECT name FROM users WHERE id=?').get(faulted).name,'Удалённый пользователь');assert.equal(db.prepare('SELECT name FROM users WHERE id=?').get(peer).name,'Fixture');
 const url='/uploads/'+randomUUID().replaceAll('-','')+'.jpg',path=app.dir+url,otherPath=app.dir+'/unrelated-private-file';await writeFile(otherPath,'Do not delete');await symlink(otherPath,path);
 db.prepare('INSERT INTO media_files VALUES(?,?,?,?,?,?)').run(url,mediaOwner,'fixture-digest','image/jpeg',1,Date.now());
 const erased=await recovered.erase(mediaOwner);assert.equal(erased.mediaCleanupPending,true);assert.equal(recovered.isErasedMedia(url),true);assert.equal(await readFile(otherPath,'utf8'),'Do not delete','cleanup must not follow symlinks');await unlink(path);await writeFile(path,'owned fixture');recovered.purgeMedia();await assert.rejects(stat(path),{code:'ENOENT'});assert.equal(await readFile(otherPath,'utf8'),'Do not delete');
 const sharedUrl='/uploads/'+randomUUID().replaceAll('-','')+'.jpg';await writeFile(app.dir+sharedUrl,'legacy shared fixture');db.prepare('UPDATE users SET photo=? WHERE id IN (?,?)').run(sharedUrl,sharedOwner,peer);await recovered.erase(sharedOwner);assert.equal(await readFile(app.dir+sharedUrl,'utf8'),'legacy shared fixture');assert.equal(db.prepare('SELECT photo FROM users WHERE id=?').get(peer).photo,sharedUrl);assert.equal(recovered.isErasedMedia(sharedUrl),false,'a shared legacy asset still belongs to the other user');
 const uploadOwner=randomUUID();db.prepare("INSERT INTO users(id,username,salt,hash,name,created) VALUES(?,?, 'x','x','Fixture',?)").run(uploadOwner,uploadOwner,Date.now());
 let release;const hold=new Promise(resolve=>{release=resolve});let finished=false;
 const upload=recovered.withUserLock(uploadOwner,async()=>{await hold;finished=true});const erasure=recovered.erase(uploadOwner);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(db.prepare('SELECT COUNT(*) n FROM account_deletions WHERE user_id=?').get(uploadOwner).n,0);release();await upload;await erasure;assert(finished);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 await writeFile(app.dir+'/privacy-erasure.jsonl','invalid-journal\n',{flag:'a'});await assert.rejects(accountPrivacy(db,app.dir),/JSON|Unexpected token/,'corrupt ledger must fail startup, never silently restore erased data');
 console.log('PASS: durable-intent crash recovery, pending-account denial, bounded retry and symlink protection, shared legacy media preservation, per-user async serialization, foreign keys and corrupt-ledger fail-closed');
}finally{db?.close();await app.stop()}

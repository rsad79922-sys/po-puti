import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {copyFile,readFile,writeFile,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {isolatedServer} from './helpers/server.mjs';
import {REDACTED,accountPrivacy} from '../server/account-privacy.mjs';

const app=await isolatedServer();let db,restored;
const password='test-'+randomUUID();
async function call(path,body,token,cookie=''){
 const response=await fetch((restored||app).base+'/api'+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
}
try{
 const users=[];for(let i=0;i<3;i++)users.push((await call('/register',{username:'erase_'+i,password})).data);
 const [subject,peer,other]=users.map(u=>u.user.id);
 db=new DatabaseSync(app.dir+'/po-puti.sqlite');db.exec('PRAGMA foreign_keys=ON');
 const insertRide=db.prepare("INSERT INTO rides(id,driver_id,origin,destination,date,time,seats,price,car,pickup,dropoff,comment,created,departure_at) VALUES(?,?,'Уфа','Пермь',?,'12:00',3,200,'Личный авто','Точный адрес','Другой адрес','Телефон в тексте',?,?)");
 const t=Date.now(),date=new Date(t+86400000).toISOString().slice(0,10);
 insertRide.run('own',subject,date,t,t+86400000);insertRide.run('peer',peer,date,t,t+86400000);insertRide.run('past',subject,'2025-01-01',t,t-86400000);insertRide.run('unrelated',peer,date,t,t+86400000);
 for(const [id,ride,user] of [['a','own',peer],['b','peer',subject],['c','past',peer],['d','unrelated',other]])db.prepare("INSERT INTO requests VALUES(?,?,?,'accepted',?,NULL)").run(id,ride,user,t);
 db.prepare("INSERT INTO messages VALUES('personal','peer',?,?,'Личные сведения',?)").run(subject,peer,t);
 db.prepare("INSERT INTO messages VALUES('unrelated','unrelated',?,?,'Чужая переписка',?)").run(peer,other,t);
 db.prepare("INSERT INTO notifications(id,recipient_id,title,message,ride_id,created,kind,target_path) VALUES('chat-note',?,'Сообщение','Личные сведения','peer',?,'chat_message',?)").run(peer,t,'/chat/peer/'+subject);
 const review=db.prepare("INSERT INTO pair_reviews VALUES(?,?,?,?,?,?,'manual',?,?,?,'allowed')");review.run('personal','past',peer,subject,4,'Личные сведения',t,t,t);review.run('unrelated','unrelated',other,peer,3,'Чужой отзыв',t,t,t);
 db.prepare("INSERT INTO reviews VALUES('legacy','past',?, ?,5,'Личный текст',?)").run(subject,peer,t);
 db.prepare("INSERT INTO ride_confirmations VALUES('past',?,'yes',?,'Личная причина')").run(subject,t);
 db.prepare("INSERT INTO admin_audit_log VALUES('audit',?,?,'user',?,'profile','{}','{\"phone\":\"secret\"}','Личный комментарий')").run(peer,t,subject);
 db.prepare("INSERT INTO ride_eta_history VALUES('eta','past',?,?,'{}','{\"pickup\":\"secret\"}','Личный комментарий')").run(subject,t);
 db.prepare("INSERT INTO reports(id,ride_id,author_id,reason,details,created) VALUES('report','past',?,'secret','secret',?)").run(subject,t);
 db.prepare("INSERT INTO push_subscriptions VALUES('push',?,'test-device-1234','android','fixture-token-abcdefghijklmnopqrstuvwxyz','{}',?,1)").run(subject,t);
 db.prepare("INSERT INTO push_subscriptions VALUES('peer-push',?,'peer-device-1234','android','peer-fixture-token-abcdefghijklmnopqrstuvwxyz','{}',?,1)").run(peer,t);
 const image=await sharp({create:{width:3,height:3,channels:3,background:'#ababab'}}).jpeg().toBuffer();
 for(const i of [0,1])assert.equal((await call('/profile',{name:'Владелец '+i,phone:'+79001112233',photo:'data:image/jpeg;base64,'+image.toString('base64')},users[i].token)).status,200);
 const url=db.prepare('SELECT photo FROM users WHERE id=?').get(subject).photo,peerUrl=db.prepare('SELECT photo FROM users WHERE id=?').get(peer).photo;
 assert.notEqual(url,peerUrl);const file=await readFile(app.dir+url);
 const before=app.dir+'/before-erase.sqlite';await backup(db,before);
 assert.equal((await call('/account/delete',{confirmation:'DELETE_MY_ACCOUNT',password:'wrong-password'},users[0].token)).status,401);
 assert.equal((await call('/account/delete',{confirmation:'DELETE_MY_ACCOUNT',password,userId:peer},users[0].token)).status,400);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM account_deletions').get().n,0);
 const result=await call('/account/delete',{confirmation:'DELETE_MY_ACCOUNT',password},null,'poputi_session_v3='+users[0].token);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.status,'anonymized');assert.match(result.cookie,/Max-Age=0/);
 const erased=db.prepare('SELECT * FROM users WHERE id=?').get(subject);assert.equal(erased.name,'Удалённый пользователь');assert.equal(erased.phone,'');assert.equal(erased.photo,'');assert(erased.blocked_at);assert.notEqual(erased.hash,db.prepare('SELECT hash FROM users WHERE id=?').get(peer).hash);
 assert.equal((await call('/state',undefined,users[0].token)).status,401);assert.equal((await call('/login',{username:'erase_0',password})).status,401);
 assert.equal(db.prepare("SELECT cancelled FROM rides WHERE id='own'").get().cancelled,1);assert.equal(db.prepare("SELECT cancelled FROM rides WHERE id='peer'").get().cancelled,0);assert.equal(db.prepare("SELECT cancelled FROM rides WHERE id='past'").get().cancelled,0);
 assert.equal(db.prepare("SELECT status FROM requests WHERE id='a'").get().status,'cancelled');assert.equal(db.prepare("SELECT status FROM requests WHERE id='b'").get().status,'cancelled');assert.equal(db.prepare("SELECT status FROM requests WHERE id='c'").get().status,'accepted');assert.equal(db.prepare("SELECT status FROM requests WHERE id='d'").get().status,'accepted');
 assert.equal(db.prepare("SELECT score FROM pair_reviews WHERE id='personal'").get().score,4);assert.equal(db.prepare("SELECT body FROM pair_reviews WHERE id='personal'").get().body,REDACTED);assert.equal(db.prepare("SELECT body FROM pair_reviews WHERE id='unrelated'").get().body,'Чужой отзыв');
 assert.equal(db.prepare("SELECT text FROM reviews WHERE id='legacy'").get().text,REDACTED);assert.equal(db.prepare("SELECT answer FROM ride_confirmations").get().answer,'yes');assert.equal(db.prepare("SELECT new_value FROM admin_audit_log WHERE id='audit'").get().new_value,'{}');assert.equal(db.prepare("SELECT new_value FROM ride_eta_history WHERE id='eta'").get().new_value,'{}');
 assert.equal(db.prepare("SELECT text FROM messages WHERE id='personal'").get().text,REDACTED);assert.equal(db.prepare("SELECT text FROM messages WHERE id='unrelated'").get().text,'Чужая переписка');assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(subject).n,0);
 assert.equal(db.prepare("SELECT message FROM notifications WHERE id='chat-note'").get().message,REDACTED);assert.equal(db.prepare("SELECT COUNT(*) n FROM push_outbox WHERE subscription_id='peer-push' AND status='pending'").get().n,2,'future cancellation notifies affected peer on each ride through the shared outbox');
 assert.equal(db.prepare("SELECT active FROM push_subscriptions WHERE id='push'").get().active,0);assert.equal((await fetch(app.base+url)).status,410);assert.equal((await fetch(app.base+peerUrl)).status,200);await assert.rejects(stat(app.dir+url),{code:'ENOENT'});assert.equal((await stat(app.dir+'/privacy-erasure.jsonl')).mode&0o777,0o600);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 // A connection with the actual scope function still cannot edit scores/text.
 await accountPrivacy(db,app.dir);
 assert.throws(()=>db.exec("UPDATE pair_reviews SET score=1 WHERE id='personal'"));assert.throws(()=>db.exec("UPDATE pair_reviews SET body='changed' WHERE id='personal'"));assert.throws(()=>db.exec("DELETE FROM pair_reviews WHERE id='personal'"));assert.throws(()=>db.prepare('UPDATE users SET blocked_at=NULL WHERE id=?').run(subject));
 db.exec("UPDATE users SET role='admin' WHERE username='erase_1'");assert.equal((await call('/account/delete',{confirmation:'DELETE_MY_ACCOUNT',password},users[1].token)).status,409,'sole administrator must transfer authority');
 db.close();db=null;app.child.kill('SIGTERM');await new Promise(resolve=>app.child.once('exit',resolve));
 // Restore an OLD DB and even an old upload, but retain the latest ledger.
 await copyFile(before,app.dir+'/po-puti.sqlite');await writeFile(app.dir+url,file,{mode:0o600});
 restored=await isolatedServer({DATA_DIR:app.dir});db=new DatabaseSync(app.dir+'/po-puti.sqlite');assert.equal(db.prepare('SELECT name FROM users WHERE id=?').get(subject).name,'Удалённый пользователь');assert.equal((await call('/state',undefined,users[0].token)).status,401);assert.equal((await fetch(restored.base+url)).status,410);await assert.rejects(stat(app.dir+url),{code:'ENOENT'});assert.equal(db.prepare("SELECT body FROM pair_reviews WHERE id='unrelated'").get().body,'Чужой отзыв');
 console.log('PASS: password/cookie/Bearer erasure, foreign-user rejection, isolated data preservation, immutable ratings, revoked sessions/push, private media removal, sole-admin guard and old-backup erasure replay');
}finally{db?.close();await restored?.stop();await app.stop()}

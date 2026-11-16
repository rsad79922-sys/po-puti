// Explicit, authenticated erasure. No account is processed from the old request queue.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,chmod} from 'node:fs/promises';
import {openSync,closeSync,readFileSync,writeSync,fsyncSync,constants,unlinkSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';

export const REDACTED='[Данные удалены владельцем аккаунта]';
const photoPattern=/^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/;
const fail=(message,status=409)=>Object.assign(Error(message),{status});

export async function accountPrivacy(db,dir){
 let subject=null;
 // Scope is a private JS closure, never a client-settable SQL table or parameter.
 db.function('privacy_subject',()=>subject);
 const get=(sql,...args)=>db.prepare(sql).get(...args);
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 const run=(sql,...args)=>db.prepare(sql).run(...args);
 if(!get("SELECT 1 FROM sqlite_master WHERE name='privacy_schema'")){
  const folder=join(dir,'migration-backups');await mkdir(folder,{recursive:true,mode:0o700});
  const path=join(folder,'before-privacy-v6-'+randomUUID()+'.sqlite');await backup(db,path);await chmod(path,0o600);
  const copy=new DatabaseSync(path,{readOnly:true});try{if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Privacy backup integrity failed')}finally{copy.close()}
  db.exec('BEGIN IMMEDIATE');try{
   db.exec(`CREATE TABLE privacy_schema(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL,backup_path TEXT NOT NULL);
    CREATE TABLE account_deletions(user_id TEXT PRIMARY KEY,receipt_id TEXT UNIQUE NOT NULL,deleted_at INTEGER NOT NULL,policy_version TEXT NOT NULL);
    CREATE TABLE privacy_erased_media(url TEXT PRIMARY KEY,deleted_at INTEGER NOT NULL,removed INTEGER NOT NULL DEFAULT 0);
    CREATE TRIGGER erased_account_no_restore BEFORE UPDATE ON users WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=OLD.id)
    AND (NEW.username IS NOT OLD.username OR NEW.name IS NOT OLD.name OR NEW.phone IS NOT OLD.phone OR NEW.car IS NOT OLD.car OR NEW.photo IS NOT OLD.photo OR NEW.salt IS NOT OLD.salt OR NEW.hash IS NOT OLD.hash OR NEW.role IS NOT OLD.role OR NEW.blocked_at IS NOT OLD.blocked_at OR NEW.blocked_reason IS NOT OLD.blocked_reason)
    BEGIN SELECT RAISE(ABORT,'Erased account cannot be reactivated'); END;`);
   // Keep immutable scores, authorship, dates and factual decisions. Only scoped
   // text redaction is allowed; ordinary review editing/deletion stays forbidden.
   for(const [table,trigger,columns,scope,changes] of [
    ['pair_reviews','pair_review_content_immutable','ride_id,author_id,target_user_id,score,body,source,submitted_at,visible_after_at','OLD.author_id=privacy_subject() OR OLD.target_user_id=privacy_subject()',{body:REDACTED}],
    ['reviews','legacy_review_content_immutable',null,'OLD.author_id=privacy_subject() OR OLD.driver_id=privacy_subject()',{text:REDACTED}],
    ['ride_confirmations','confirmation_no_update',null,'OLD.user_id=privacy_subject()',{reason:REDACTED}],
    ['admin_audit_log','audit_no_update',null,"OLD.actor_id=privacy_subject() OR (OLD.entity_type='user' AND OLD.entity_id=privacy_subject()) OR (OLD.entity_type='ride' AND OLD.entity_id IN (SELECT id FROM rides WHERE driver_id=privacy_subject())) OR (OLD.entity_type IN ('report','complaint') AND OLD.entity_id IN (SELECT id FROM reports WHERE author_id=privacy_subject() OR ride_id IN (SELECT id FROM rides WHERE driver_id=privacy_subject()))) OR (OLD.entity_type='review' AND OLD.entity_id IN (SELECT id FROM pair_reviews WHERE author_id=privacy_subject() OR target_user_id=privacy_subject() UNION ALL SELECT id FROM reviews WHERE author_id=privacy_subject() OR driver_id=privacy_subject()))",{old_value:'{}',new_value:'{}',reason:REDACTED}],
    ['ride_eta_history','eta_history_no_update',null,'OLD.actor_id=privacy_subject() OR OLD.ride_id IN (SELECT id FROM rides WHERE driver_id=privacy_subject())',{old_value:'{}',new_value:'{}',reason:REDACTED}]
   ]){
    const quote=value=>"'"+value.replaceAll("'","''")+"'";
    const unchanged=all('PRAGMA table_info('+table+')').map(c=>Object.hasOwn(changes,c.name)?'NEW.'+c.name+' IS '+quote(changes[c.name]):'NEW.'+c.name+' IS OLD.'+c.name).join(' AND ');
    db.exec(`DROP TRIGGER ${trigger};CREATE TRIGGER ${trigger} BEFORE UPDATE ${columns?'OF '+columns:''} ON ${table}
     WHEN NOT (privacy_subject() IS NOT NULL AND (${scope}) AND ${unchanged}) BEGIN SELECT RAISE(ABORT,'Immutable content; only scoped privacy redaction allowed'); END;`);
   }
   run('INSERT INTO privacy_schema VALUES(6,?,?)',Date.now(),path);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
 }else if(get('SELECT MAX(version) v FROM privacy_schema').v!==6)throw Error('Unsupported privacy schema');

 const locks=new Map(),pending=new Set();
 async function withUserLock(id,work){
  const previous=locks.get(id)||Promise.resolve();let release;
  const gate=new Promise(resolve=>{release=resolve}),tail=previous.then(()=>gate);locks.set(id,tail);
  await previous;try{return await work()}finally{release();if(locks.get(id)===tail)locks.delete(id)}
 }
 const ledger=join(dir,'privacy-erasure.jsonl');
 function recordIntent(record){
  const fd=openSync(ledger,constants.O_APPEND|constants.O_CREAT|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{const bytes=Buffer.from(JSON.stringify(record)+'\n');let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset);fsyncSync(fd)}finally{closeSync(fd)}
  const folder=openSync(dir,constants.O_RDONLY);try{fsyncSync(folder)}finally{closeSync(folder)}
 }
 function mediaFor(id){return [...new Set([
  ...all('SELECT url FROM media_files WHERE owner_id=?',id).map(r=>r.url),
  get('SELECT photo FROM users WHERE id=?',id)?.photo,
  ...all('SELECT photo FROM rides WHERE driver_id=?',id).map(r=>r.photo)
 ].filter(url=>photoPattern.test(url||'')))];}
 function apply(record){
  const {userId:id,receiptId,deletedAt,policyVersion,media}=record;
  if(get('SELECT 1 FROM account_deletions WHERE user_id=?',id))return;
  db.exec('BEGIN IMMEDIATE');subject=id;
  try{
   if(get('SELECT 1 FROM users WHERE id=?',id)){
    const future="(departure_at>? OR (departure_at IS NULL AND date>=?))";
    const date=new Date(deletedAt).toISOString().slice(0,10);
    // No nested transactions, no modification of completed participation facts.
    const affected=all(`SELECT DISTINCT r.id,r.driver_id,q.user_id FROM rides r LEFT JOIN requests q ON q.ride_id=r.id AND q.status IN ('pending','accepted') WHERE ${future} AND (r.driver_id=? OR q.user_id=?)`,deletedAt,date,id,id);
    for(const r of affected){const peer=r.driver_id===id?r.user_id:r.driver_id;if(!peer||peer===id||get('SELECT blocked_at FROM users WHERE id=?',peer)?.blocked_at)continue;
     const key='account-erased:'+receiptId+':'+r.id+':'+peer;
     const noteId=randomUUID();const inserted=run('INSERT OR IGNORE INTO notifications(id,recipient_id,title,message,ride_id,read,created,kind,target_path,event_key) VALUES(?,?,?,?,?,0,?,?,?,?)',noteId,peer,'Участие отменено','Участник удалил аккаунт. Проверьте состояние поездки.',r.id,deletedAt,'account_erased','/ride/'+r.id,key);
     if(inserted.changes)for(const sub of all('SELECT id FROM push_subscriptions WHERE user_id=? AND active=1',peer))run('INSERT OR IGNORE INTO push_outbox(id,notification_id,subscription_id,next_attempt_at) VALUES(?,?,?,?)',randomUUID(),noteId,sub.id,deletedAt);
    }
    run(`UPDATE requests SET status='cancelled' WHERE status IN ('pending','accepted') AND ride_id IN (SELECT id FROM rides WHERE ${future}) AND (user_id=? OR ride_id IN (SELECT id FROM rides WHERE driver_id=?))`,deletedAt,date,id,id);
    run(`UPDATE rides SET cancelled=1 WHERE driver_id=? AND ${future}`,id,deletedAt,date);
    run("UPDATE rides SET origin='Маршрут удалён',destination='Маршрут удалён',car='',pickup='',dropoff='',luggage='',comment='',photo='',route_points_json='[]' WHERE driver_id=?",id);
    for(const row of all('SELECT id,template_json FROM ride_series WHERE driver_id=?',id)){
     // Only retain scheduling; exact route/address templates must not revive data.
     run("UPDATE ride_series SET template_json='{}' WHERE id=?",row.id);
     run("UPDATE ride_series_revisions SET details_json='{}' WHERE series_id=?",row.id);
     run('UPDATE ride_series_exceptions SET reason=? WHERE series_id=?',REDACTED,row.id);
    }
    run('UPDATE pair_reviews SET body=? WHERE author_id=? OR target_user_id=?',REDACTED,id,id);
    run('UPDATE reviews SET text=? WHERE author_id=? OR driver_id=?',REDACTED,id,id);
    run('UPDATE ride_confirmations SET reason=? WHERE user_id=?',REDACTED,id);
    run('UPDATE admin_audit_log SET old_value=?,new_value=?,reason=? WHERE actor_id=? OR (entity_type=? AND entity_id=?) OR (entity_type=? AND entity_id IN (SELECT id FROM rides WHERE driver_id=?))','{}','{}',REDACTED,id,'user',id,'ride',id);
    run("UPDATE admin_audit_log SET old_value='{}',new_value='{}',reason=? WHERE (entity_type IN ('report','complaint') AND entity_id IN (SELECT id FROM reports WHERE author_id=? OR ride_id IN (SELECT id FROM rides WHERE driver_id=?))) OR (entity_type='review' AND entity_id IN (SELECT id FROM pair_reviews WHERE author_id=? OR target_user_id=? UNION ALL SELECT id FROM reviews WHERE author_id=? OR driver_id=?))",REDACTED,id,id,id,id,id,id);
    run('UPDATE ride_eta_history SET old_value=?,new_value=?,reason=? WHERE actor_id=? OR ride_id IN (SELECT id FROM rides WHERE driver_id=?)','{}','{}',REDACTED,id,id);
    run('UPDATE messages SET text=? WHERE from_id=? OR to_id=?',REDACTED,id,id);
    run('UPDATE reports SET reason=?,details=?,decision=CASE WHEN decision IS NULL THEN NULL ELSE ? END WHERE author_id=? OR ride_id IN (SELECT id FROM rides WHERE driver_id=?)',REDACTED,REDACTED,REDACTED,id,id);
    run('UPDATE moderation_decisions SET comment=? WHERE ride_id IN (SELECT id FROM rides WHERE driver_id=?) OR report_id IN (SELECT id FROM reports WHERE author_id=?)',REDACTED,id,id);
    run('UPDATE notifications SET title=?,message=? WHERE recipient_id=? OR ride_id IN (SELECT id FROM rides WHERE driver_id=?)',REDACTED,REDACTED,id,id);
    run("UPDATE notifications SET title=?,message=? WHERE kind='chat_message' AND target_path LIKE ?",REDACTED,REDACTED,'%/'+id);
    // Name-bearing booking alerts on other drivers' rides reference no actor id.
    run("UPDATE notifications SET title=?,message=? WHERE kind IN ('booking_created','booking_cancelled','booking_accepted','booking_rejected') AND ride_id IN (SELECT ride_id FROM requests WHERE user_id=?)",REDACTED,REDACTED,id);
    run("UPDATE push_outbox SET status='cancelled',last_error='' WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE user_id=?) AND status IN ('pending','retry','sending')",id);
    run("UPDATE push_subscriptions SET active=0,address='erased:'||id,device_id='erased:'||id,keys_json='{}' WHERE user_id=?",id);
    for(const table of ['sessions','admin_mfa','privacy_consents','route_quotes'])run('DELETE FROM '+table+' WHERE user_id=?',id);
    run("UPDATE deletion_requests SET status='completed' WHERE user_id=?",id);
    run("UPDATE users SET username=?,salt=?,hash=?,name='Удалённый пользователь',phone='',car='',photo='',role='user',blocked_at=?,blocked_reason='Аккаунт удалён владельцем' WHERE id=?",'!deleted:'+randomUUID(),randomBytes(20).toString('hex'),randomBytes(64).toString('hex'),deletedAt,id);
   }
   for(const url of media){
    // Old shared legacy files must not remove another person's photo.
    if(get('SELECT 1 FROM users WHERE photo=? AND id<>? UNION ALL SELECT 1 FROM rides WHERE photo=? AND driver_id<>? UNION ALL SELECT 1 FROM media_files WHERE url=? AND owner_id<>? LIMIT 1',url,id,url,id,url,id))continue;
    run('INSERT OR IGNORE INTO privacy_erased_media VALUES(?,?,0)',url,deletedAt);
   }
   run('DELETE FROM media_files WHERE owner_id=?',id);
   run('INSERT INTO account_deletions VALUES(?,?,?,?)',id,receiptId,deletedAt,policyVersion);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}finally{subject=null}
 }
 function purgeMedia(){
  for(const row of all('SELECT url FROM privacy_erased_media WHERE removed=0 LIMIT 100')){
   if(!photoPattern.test(row.url))throw Error('Invalid erased media path');
   try{const path=join(dir,row.url.slice(1));const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe media file');unlinkSync(path);run('UPDATE privacy_erased_media SET removed=1 WHERE url=?',row.url)}
   catch(error){if(error.code==='ENOENT')run('UPDATE privacy_erased_media SET removed=1 WHERE url=?',row.url);else console.error('[privacy-media] pending private file cleanup')}
  }
 }
 function replay(){
  let text;try{const fd=openSync(ledger,constants.O_RDONLY|constants.O_NOFOLLOW);try{if(lstatSync(ledger).size>64*1024*1024)throw Error('Privacy ledger requires offline compaction');text=readFileSync(fd,'utf8')}finally{closeSync(fd)}}catch(error){if(error.code==='ENOENT')return;throw error}
  for(const line of text.split('\n').filter(Boolean)){
   const r=JSON.parse(line);
   if(!/^[a-f0-9-]{36}$/.test(r.userId||'')||!/^[a-f0-9-]{36}$/.test(r.receiptId||'')||!Number.isSafeInteger(r.deletedAt)||r.deletedAt<=0||r.policyVersion!=='2026-11-v6'||!Array.isArray(r.media)||r.media.some(url=>!photoPattern.test(url)))throw Error('Invalid privacy ledger; startup stopped to prevent data resurrection');
   pending.add(r.userId);apply(r);
  }
 }
 // Runs before accepting requests and before migrating legacy inline photos.
 replay();run('UPDATE privacy_erased_media SET removed=0');purgeMedia();
 return {withUserLock,purgeMedia,isUnavailable:id=>pending.has(id)||!!get('SELECT 1 FROM account_deletions WHERE user_id=?',id),isErasedMedia:url=>!!get('SELECT 1 FROM privacy_erased_media WHERE url=?',url),
  erase:async id=>withUserLock(id,()=>{
   const user=get('SELECT * FROM users WHERE id=?',id);if(!user||user.blocked_at)throw fail('Аккаунт недоступен',401);
   if(user.role==='admin'&&!get("SELECT 1 FROM users WHERE role='admin' AND blocked_at IS NULL AND id<>?",id))throw fail('Сначала назначьте другого администратора');
   const record={userId:id,receiptId:randomUUID(),deletedAt:Date.now(),policyVersion:'2026-11-v6',media:mediaFor(id)};
   recordIntent(record);pending.add(id);apply(record);purgeMedia();
   return {ok:true,status:'anonymized',receiptId:record.receiptId,mediaCleanupPending:get('SELECT COUNT(*) n FROM privacy_erased_media WHERE removed=0').n>0};
  })};
}

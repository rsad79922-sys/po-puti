/** Server-authoritative trip lifecycle, immutable pair reviews and audited moderation. */
import {backup,DatabaseSync} from 'node:sqlite';
import {mkdir,chmod,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export const DAY=86400000,HOUR=3600000;
export const fail=(text,status=400)=>Object.assign(new Error(text),{status});
export async function migrateLifecycle(db,dataDir){
 if(db.prepare("SELECT name FROM sqlite_master WHERE name='lifecycle_schema'").get()){if(db.prepare("SELECT MAX(version) version FROM lifecycle_schema").get()?.version!==3)throw Error("Unsupported lifecycle schema version");return;}
 const dir=join(dataDir,'migration-backups');await mkdir(dir,{recursive:true,mode:0o700});
 const destination=join(dir,'before-lifecycle-v3-'+randomUUID()+'.sqlite');
 await backup(db,destination);await chmod(destination,0o600);
 const verify=new DatabaseSync(destination,{readOnly:true});
 try{if(verify.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Migration backup failed integrity check')}finally{verify.close()}
 if(!(await stat(destination)).size)throw Error('Empty migration backup');
 db.exec('BEGIN IMMEDIATE');
 try{
  const add=(table,name,type)=>{if(!db.prepare('PRAGMA table_info('+table+')').all().some(x=>x.name===name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type)};
  for(const [name,type] of [['departure_at','INTEGER'],['departure_offset','TEXT'],['estimated_duration_minutes','INTEGER'],['estimated_arrival_at','INTEGER'],['eta_source',"TEXT NOT NULL DEFAULT 'legacy_unknown'"],['outcome',"TEXT NOT NULL DEFAULT 'pending_confirmation'"],['outcome_override','TEXT'],['moderation_blocked','INTEGER NOT NULL DEFAULT 0']])add('rides',name,type);
  add('requests','expired_at','INTEGER');add('users','blocked_at','INTEGER');add('users','blocked_reason',"TEXT NOT NULL DEFAULT ''");
  add('notifications','read_at','INTEGER');add('notifications','event_key','TEXT');add('notifications','kind',"TEXT NOT NULL DEFAULT 'legacy'");add('notifications','target_path',"TEXT NOT NULL DEFAULT '/notifications'");
  add('reports','status',"TEXT NOT NULL DEFAULT 'open'");add('reports','category',"TEXT NOT NULL DEFAULT 'general'");add('reports','decision',"TEXT NOT NULL DEFAULT ''");add('reports','resolved_at','INTEGER');
  db.exec(`
   CREATE TABLE ride_confirmations(ride_id TEXT NOT NULL REFERENCES rides(id),user_id TEXT NOT NULL REFERENCES users(id),answer TEXT NOT NULL CHECK(answer IN ('yes','no')),responded_at INTEGER NOT NULL,reason TEXT NOT NULL DEFAULT '',PRIMARY KEY(ride_id,user_id));
   CREATE TABLE pair_reviews(id TEXT PRIMARY KEY,ride_id TEXT NOT NULL REFERENCES rides(id),author_id TEXT NOT NULL REFERENCES users(id),target_user_id TEXT NOT NULL REFERENCES users(id),score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),body TEXT NOT NULL DEFAULT '',source TEXT NOT NULL CHECK(source IN ('manual','automatic')),submitted_at INTEGER NOT NULL,visible_after_at INTEGER NOT NULL,published_at INTEGER,moderation_status TEXT NOT NULL DEFAULT 'allowed' CHECK(moderation_status IN ('allowed','blocked')),UNIQUE(ride_id,author_id,target_user_id));
   CREATE TABLE legacy_review_moderation(review_id TEXT PRIMARY KEY REFERENCES reviews(id),status TEXT NOT NULL CHECK(status IN ('allowed','blocked')));
   CREATE VIEW review_admin_view AS SELECT id,ride_id,author_id,target_user_id,score,body,source,submitted_at,visible_after_at,published_at,moderation_status FROM pair_reviews UNION ALL SELECT v.id,v.ride_id,v.author_id,v.driver_id,v.score,v.text,'legacy',v.created,v.created,v.created,COALESCE(m.status,'allowed') FROM reviews v LEFT JOIN legacy_review_moderation m ON m.review_id=v.id;
   CREATE INDEX ix_pair_reviews_due ON pair_reviews(published_at,visible_after_at);
   CREATE INDEX ix_pair_reviews_target ON pair_reviews(target_user_id);
   CREATE UNIQUE INDEX ix_notifications_event ON notifications(recipient_id,event_key) WHERE event_key IS NOT NULL;
   CREATE TABLE admin_audit_log(id TEXT PRIMARY KEY,actor_id TEXT,created_at INTEGER NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,old_value TEXT NOT NULL,new_value TEXT NOT NULL,reason TEXT NOT NULL);
   CREATE TABLE moderation_decisions(id TEXT PRIMARY KEY,ride_id TEXT NOT NULL REFERENCES rides(id),report_id TEXT REFERENCES reports(id),decision TEXT NOT NULL,comment TEXT NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE push_subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),device_id TEXT NOT NULL,platform TEXT NOT NULL CHECK(platform IN ('web','android')),address TEXT NOT NULL UNIQUE,keys_json TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,UNIQUE(user_id,device_id,platform));
   CREATE TABLE push_outbox(id TEXT PRIMARY KEY,notification_id TEXT NOT NULL REFERENCES notifications(id),subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id),status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,last_error TEXT NOT NULL DEFAULT '',delivered_at INTEGER,UNIQUE(notification_id,subscription_id));
   CREATE INDEX ix_push_outbox_due ON push_outbox(status,next_attempt_at);
   CREATE TABLE system_message_templates(kind TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL);
   CREATE TABLE background_state(name TEXT PRIMARY KEY,last_started_at INTEGER,last_finished_at INTEGER,last_error TEXT NOT NULL DEFAULT '');
   CREATE TRIGGER pair_review_content_immutable BEFORE UPDATE OF ride_id,author_id,target_user_id,score,body,source,submitted_at,visible_after_at ON pair_reviews BEGIN SELECT RAISE(ABORT,'Review content is immutable'); END;
   CREATE TRIGGER pair_review_no_delete BEFORE DELETE ON pair_reviews BEGIN SELECT RAISE(ABORT,'Reviews cannot be deleted'); END;
   CREATE TRIGGER legacy_review_content_immutable BEFORE UPDATE ON reviews BEGIN SELECT RAISE(ABORT,'Legacy review is immutable'); END;
   CREATE TRIGGER legacy_review_no_delete BEFORE DELETE ON reviews BEGIN SELECT RAISE(ABORT,'Legacy reviews cannot be deleted'); END;
   CREATE TRIGGER audit_no_update BEFORE UPDATE ON admin_audit_log BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
   CREATE TRIGGER audit_no_delete BEFORE DELETE ON admin_audit_log BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
   CREATE TRIGGER confirmation_no_update BEFORE UPDATE ON ride_confirmations BEGIN SELECT RAISE(ABORT,'Confirmation is final'); END;
   CREATE TRIGGER confirmation_no_delete BEFORE DELETE ON ride_confirmations BEGIN SELECT RAISE(ABORT,'Confirmation is final'); END;
   CREATE TABLE lifecycle_schema(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL,backup_path TEXT NOT NULL);
  `);
  // Preserve old calendar values exactly; unknown timezone/ETA is never invented.
  db.prepare('INSERT INTO lifecycle_schema VALUES(?,?,?)').run(3,Date.now(),destination);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
}
export function lifecycle(db,{clock=Date.now,pushAvailable=()=>({web:false,android:false}),pushDispatch=async()=>{}}={}){
 const get=(sql,...a)=>db.prepare(sql).get(...a),all=(sql,...a)=>db.prepare(sql).all(...a),run=(sql,...a)=>db.prepare(sql).run(...a);
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}};
 const ride=id=>{const r=get('SELECT * FROM rides WHERE id=?',id);if(!r)throw fail('Поездка не найдена',404);return r};
 const members=r=>[r.driver_id,...all("SELECT user_id FROM requests WHERE ride_id=? AND status='accepted'",r.id).map(x=>x.user_id)];
 const departure=r=>r.departure_at??Date.parse(r.date+'T'+r.time+':00Z');
 function describe(r){const t=clock(),dep=departure(r),eta=r.estimated_arrival_at;return {departureOffset:r.departure_offset,departureAt:r.departure_at?new Date(r.departure_at).toISOString():null,estimatedArrivalAt:eta?new Date(eta).toISOString():null,estimatedDurationMinutes:r.estimated_duration_minutes,etaSource:r.eta_source,phase:r.cancelled?'cancelled':t<dep?'scheduled':eta&&t>=eta||!r.departure_at?'past':'in_progress',outcome:r.outcome,canChangeParticipants:!r.cancelled&&t<dep,confirmationOpenAt:eta?eta+HOUR:null,confirmationCloseAt:eta?eta+HOUR+14*DAY:null,serverNow:t,moderationBlocked:!!r.moderation_blocked}}
 function mutable(r){if(get('SELECT blocked_at FROM users WHERE id=?',r.driver_id)?.blocked_at)throw fail('Водитель заблокирован',409);if(r.cancelled||clock()>=departure(r))throw fail('После отправления изменение поездки и списка пассажиров запрещено',409);if(r.moderation_blocked)throw fail('Объявление заблокировано модератором',409)}
 function event(user,kind,key,title,body,path='/notifications',rideId=''){
  const template=get('SELECT * FROM system_message_templates WHERE kind=?',kind);
  const id=randomUUID();const result=run('INSERT OR IGNORE INTO notifications(id,recipient_id,title,message,ride_id,read,created,event_key,kind,target_path) VALUES(?,?,?,?,?,0,?,?,?,?)',id,user,template?.title||title,template?.body||body,rideId,clock(),key,kind,path);
  if(Number(result.changes))for(const sub of all('SELECT id FROM push_subscriptions WHERE user_id=? AND active=1',user))run('INSERT OR IGNORE INTO push_outbox(id,notification_id,subscription_id,next_attempt_at) VALUES(?,?,?,?)',randomUUID(),id,sub.id,clock());
 }
 function audit(actor,type,id,action,oldValue,newValue,reason){if(typeof reason!=='string'||!reason.trim()||reason.length>1000)throw fail('Укажите основание решения (до 1000 символов)');run('INSERT INTO admin_audit_log VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),actor?.id||null,clock(),type,id,action,JSON.stringify(oldValue),JSON.stringify(newValue),reason.trim())}
 function outcome(r,t){
  if(r.cancelled)return 'cancelled';if(!r.estimated_arrival_at)return r.outcome_override||'pending_confirmation';
  if(r.outcome_override)return r.outcome_override;
  const people=members(r),answers=all('SELECT * FROM ride_confirmations WHERE ride_id=?',r.id),yes=answers.filter(a=>a.answer==='yes'),no=answers.filter(a=>a.answer==='no');
  if(get("SELECT id FROM reports WHERE ride_id=? AND category='ride_fact' AND status='open'",r.id)||yes.length&&no.length)return 'disputed';
  if(no.length===people.length&&no.length>0)return 'not_held';
  if(yes.some(a=>a.user_id===r.driver_id)&&(people.length===1||yes.some(a=>a.user_id!==r.driver_id)))return 'completed';
  return t>=r.estimated_arrival_at+HOUR+14*DAY?'unverified':'pending_confirmation';
 }
 const targets=(r,user)=>user===r.driver_id?members(r).filter(id=>id!==user):members(r).includes(user)?[r.driver_id]:[];
 const answer=(id,user)=>get('SELECT * FROM ride_confirmations WHERE ride_id=? AND user_id=?',id,user);
 const eligible=(r,author,target)=>!r.cancelled&&r.outcome==='completed'&&!r.moderation_blocked&&answer(r.id,author)?.answer==='yes'&&answer(r.id,target)?.answer==='yes';
 function tickTransaction(onlyId){
  const t=clock();
  const queued=!!get("SELECT name FROM sqlite_master WHERE name='lifecycle_due'");
  const selected=onlyId?all('SELECT * FROM rides WHERE id=?',onlyId):queued?all('SELECT r.* FROM lifecycle_due d JOIN rides r ON r.id=d.ride_id WHERE d.next_run_at<=? ORDER BY d.next_run_at LIMIT 100',t):all('SELECT * FROM rides');
  for(const r of selected){
   if(t>=departure(r))run("UPDATE requests SET expired_at=? WHERE ride_id=? AND status='pending' AND expired_at IS NULL",t,r.id);
   const result=outcome(r,t);if(result!==r.outcome){run('UPDATE rides SET outcome=? WHERE id=?',result,r.id);r.outcome=result}
   if(!r.cancelled&&r.estimated_arrival_at&&t>=r.estimated_arrival_at+HOUR){
    const close=r.estimated_arrival_at+HOUR+14*DAY;
    for(const person of members(r)){
     if(t<close&&!answer(r.id,person))event(person,'ride_confirmation','confirmation:'+r.id,'Поездка состоялась?','Подтвердите факт участия в поездке.','/ride/'+r.id,r.id);
     const a=answer(r.id,person);if(a?.answer!=='yes')continue;
     for(const target of targets(r,person)){
      const previous=get('SELECT id FROM pair_reviews WHERE ride_id=? AND author_id=? AND target_user_id=?',r.id,person,target);
      const legacy=get('SELECT id FROM reviews WHERE ride_id=? AND author_id=? AND driver_id=?',r.id,person,target);
      if(previous||legacy)continue;
      const due=a.responded_at+7*DAY;
      if(t<due&&t>=a.responded_at+DAY)event(person,'review_reminder','reminder:'+r.id+':'+target,'Оцените поездку','Вы ещё можете отправить отзыв.','/ride/'+r.id,r.id);
      if(t>=due&&eligible(r,person,target))run("INSERT OR IGNORE INTO pair_reviews(id,ride_id,author_id,target_user_id,score,body,source,submitted_at,visible_after_at,published_at) VALUES(?,?,?,?,5,?,'automatic',?,?,?)",randomUUID(),r.id,person,target,'Оценка выставлена автоматически',due,due,due);
     }
    }
   }
   if(r.outcome==='completed'&&!r.moderation_blocked){
    for(const review of all("SELECT * FROM pair_reviews WHERE ride_id=? AND source='manual' AND moderation_status='allowed' AND published_at IS NULL AND visible_after_at<=?",r.id,t)){
     run('UPDATE pair_reviews SET published_at=? WHERE id=?',review.visible_after_at,review.id);
     event(review.target_user_id,'review_published','review-published:'+review.id,'Опубликован отзыв','В вашем профиле появился новый отзыв.','/reviews/'+review.target_user_id,r.id);
    }
   }
   if(queued){const dates=[departure(r),r.estimated_arrival_at&&r.estimated_arrival_at+HOUR,r.estimated_arrival_at&&r.estimated_arrival_at+HOUR+14*DAY,...all('SELECT responded_at FROM ride_confirmations WHERE ride_id=?',r.id).flatMap(a=>[a.responded_at+DAY,a.responded_at+7*DAY]),...all("SELECT visible_after_at FROM pair_reviews WHERE ride_id=? AND published_at IS NULL AND moderation_status='allowed'",r.id).map(v=>v.visible_after_at)].filter(v=>Number.isFinite(v)&&v>t);run('INSERT INTO lifecycle_due VALUES(?,?) ON CONFLICT(ride_id) DO UPDATE SET next_run_at=excluded.next_run_at',r.id,dates.length?Math.min(...dates):8640000000000000);}
  }
  run("INSERT INTO background_state(name,last_started_at,last_finished_at,last_error) VALUES('lifecycle',?,?,'') ON CONFLICT(name) DO UPDATE SET last_started_at=excluded.last_started_at,last_finished_at=excluded.last_finished_at,last_error=''",t,t);
 }
 function tick(){try{return tx(tickTransaction)}catch(e){run("INSERT INTO background_state(name,last_error) VALUES('lifecycle',?) ON CONFLICT(name) DO UPDATE SET last_error=excluded.last_error",String(e.message).slice(0,300));throw e}}
 function publicReview(x){return {id:x.id,rideId:x.ride_id,driverId:x.target_user_id,targetUserId:x.target_user_id,authorId:x.author_id,author:get('SELECT name FROM users WHERE id=?',x.author_id)?.name||'Участник',score:x.score,text:x.body,date:new Date(x.submitted_at).toISOString().slice(0,10),submittedAt:x.submitted_at,visibleAfterAt:x.visible_after_at,publishedAt:x.published_at,source:x.source,isAuto:x.source==='automatic',moderationStatus:x.moderation_status,isPublished:x.source==='legacy'?x.moderation_status==='allowed':!!x.published_at&&x.visible_after_at<=clock()&&x.moderation_status==='allowed'&&ride(x.ride_id).outcome==='completed'&&!ride(x.ride_id).moderation_blocked}}
 function reviewsFor(user,visibleIds){return all('SELECT p.* FROM pair_reviews p JOIN rides r ON r.id=p.ride_id WHERE p.author_id=? OR (p.published_at IS NOT NULL AND p.visible_after_at<=? AND p.moderation_status=\'allowed\' AND r.outcome=\'completed\' AND r.moderation_blocked=0)',user,clock()).filter(x=>x.author_id===user||visibleIds.has(x.target_user_id)).map(publicReview)}
 function statusLabel(r,user){const d=describe(r);if(d.phase==='cancelled')return 'Отменена';if(d.phase==='scheduled')return 'Поездка запланирована';if(d.phase==='in_progress')return 'Поездка в пути (расчётно)';const a=user?answer(r.id,user):null;const canConfirm=user&&members(r).includes(user)&&r.estimated_arrival_at&&clock()>=r.estimated_arrival_at+HOUR&&clock()<r.estimated_arrival_at+HOUR+14*DAY&&!a;if(canConfirm)return 'Подтвердите, состоялась ли поездка';if(r.outcome==='pending_confirmation')return !r.estimated_arrival_at?'Расчёт прибытия отсутствует':clock()<r.estimated_arrival_at+HOUR?'Ожидание подтверждения после прибытия':'Ожидание ответов участников';return ({completed:'Состоялась',not_held:'Не состоялась',disputed:'Спорная',unverified:'Не подтверждена'})[r.outcome]||'Ожидание ответов участников'}
 function participation(r,user){const a=answer(r.id,user),existing=all('SELECT * FROM pair_reviews WHERE ride_id=? AND author_id=?',r.id,user);return {rideId:r.id,statusLabel:statusLabel(r,user),answer:a?.answer||null,respondedAt:a?.responded_at||null,reason:a?.reason||'',canConfirm:members(r).includes(user)&&!r.cancelled&&!!r.estimated_arrival_at&&clock()>=r.estimated_arrival_at+HOUR&&clock()<r.estimated_arrival_at+HOUR+14*DAY&&!a,reviewTargets:a?.answer==='yes'?targets(r,user).map(target=>({userId:target,state:existing.some(x=>x.target_user_id===target)?'submitted':clock()>=a.responded_at+7*DAY?'closed':'pending_by_user',autoRatingDueAt:a.responded_at+7*DAY})):[]}}
 function submitReview(actor,data){return tx(()=>{
  tickTransaction(String(data.rideId||''));const r=ride(String(data.rideId||'')),target=String(data.targetUserId||r.driver_id);
  if(!targets(r,actor.id).includes(target)||!members(r).includes(actor.id))throw fail('Отзыв доступен только подтверждённым участникам',403);
  const previous=get('SELECT * FROM pair_reviews WHERE ride_id=? AND author_id=? AND target_user_id=?',r.id,actor.id,target);
  if(previous){if(previous.source==='automatic')throw fail('Срок отзыва закрыт: создана системная оценка',409);return {id:previous.id,repeated:true,review:publicReview(previous)}}
  const legacy=get('SELECT id FROM reviews WHERE ride_id=? AND author_id=? AND driver_id=?',r.id,actor.id,target);if(legacy)return {id:legacy.id,repeated:true};
  const a=answer(r.id,actor.id);if(!a||a.answer!=='yes'||r.cancelled)throw fail('Сначала подтвердите участие ответом «Да»',403);
  if(clock()>=a.responded_at+7*DAY)throw fail('Срок отправки отзыва закрыт',409);
  const score=Number(data.score),body=data.body??data.text??'';if(!Number.isInteger(score)||score<1||score>5||typeof body!=='string'||body.length>500)throw fail('Оценка 1–5, текст до 500 символов');
  const t=clock(),id=randomUUID();run("INSERT INTO pair_reviews(id,ride_id,author_id,target_user_id,score,body,source,submitted_at,visible_after_at) VALUES(?,?,?,?,?,?,'manual',?,?)",id,r.id,actor.id,target,score,body.trim(),t,t+7*DAY);
  return {id,review:publicReview(get('SELECT * FROM pair_reviews WHERE id=?',id)),message:'Отзыв сохранён. Он станет доступен другим пользователям через 7 дней'};
 })}
 function confirm(actor,data){return tx(()=>{
  tickTransaction(String(data.rideId||''));const r=ride(String(data.rideId||''));if(!members(r).includes(actor.id))throw fail('Вы не подтверждённый участник',403);
  const old=answer(r.id,actor.id);if(old){if(old.answer!==data.answer)throw fail('Окончательный ответ уже сохранён',409);return {participation:participation(r,actor.id),openReview:old.answer==='yes'}}
  if(!r.estimated_arrival_at||r.cancelled||clock()<r.estimated_arrival_at+HOUR||clock()>=r.estimated_arrival_at+HOUR+14*DAY)throw fail('Подтверждение сейчас недоступно',409);
  if(!['yes','no'].includes(data.answer))throw fail('Выберите «Да» или «Нет»');
  const reason=typeof data.reason==='string'?data.reason.trim():'';if(reason.length>500||data.answer==='no'&&!reason)throw fail('Укажите причину ответа «Нет»');
  const opposite=get('SELECT user_id FROM ride_confirmations WHERE ride_id=? AND answer<>?',r.id,data.answer);
  run('INSERT INTO ride_confirmations VALUES(?,?,?,?,?)',r.id,actor.id,data.answer,clock(),reason);
  if(r.outcome_override&&opposite)run('UPDATE rides SET outcome_override=NULL WHERE id=?',r.id); // New contradictory evidence reopens an already moderated outcome.
  tickTransaction(r.id);return {participation:participation(ride(r.id),actor.id),openReview:data.answer==='yes'};
 })}
 function addTiming(data){
  if(data.departureAt===undefined&&data.estimatedDurationMinutes===undefined)return null; // old client: explicit legacy unknown ETA
  const value=data.departureAt;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.test(value))throw fail('Укажите время отправления с часовым поясом');
  if(value.slice(0,10)!==data.date||value.slice(11,16)!==data.time)throw fail('Дата и время должны соответствовать departureAt');
  const dep=Date.parse(value),minutes=Number(data.estimatedDurationMinutes);
  if(!Number.isFinite(dep)||dep<=clock()||!Number.isInteger(minutes)||minutes<1||minutes>10080)throw fail('Проверьте будущее время отправления и длительность (1–10080 минут)');
  return {departure_at:dep,departure_offset:value.endsWith('Z')?'+00:00':value.slice(-6),estimated_duration_minutes:minutes,estimated_arrival_at:dep+minutes*60000,eta_source:'driver_manual'};
 }
 function attachTiming(id,timing){if(timing)run('UPDATE rides SET departure_at=?,departure_offset=?,estimated_duration_minutes=?,estimated_arrival_at=?,eta_source=? WHERE id=?',timing.departure_at,timing.departure_offset,timing.estimated_duration_minutes,timing.estimated_arrival_at,timing.eta_source,id)}
 function ratingFor(user){
  const manual=get("SELECT COUNT(*) count,AVG(score) average FROM (SELECT p.score FROM pair_reviews p JOIN rides r ON r.id=p.ride_id WHERE p.target_user_id=? AND p.source='manual' AND p.moderation_status='allowed' AND p.published_at IS NOT NULL AND p.visible_after_at<=? AND r.outcome='completed' AND r.moderation_blocked=0 UNION ALL SELECT v.score FROM reviews v LEFT JOIN legacy_review_moderation m ON m.review_id=v.id WHERE v.driver_id=? AND COALESCE(m.status,'allowed')='allowed')",user,clock(),user);
  return {...manual,automaticCount:get("SELECT COUNT(*) n FROM pair_reviews p JOIN rides r ON r.id=p.ride_id WHERE target_user_id=? AND source='automatic' AND moderation_status='allowed' AND published_at IS NOT NULL AND r.outcome='completed' AND r.moderation_blocked=0",user).n};
 }
 function enqueueExisting(id){const n=get('SELECT * FROM notifications WHERE id=?',id);if(!n)return;for(const s of all('SELECT id FROM push_subscriptions WHERE user_id=? AND active=1',n.recipient_id))run('INSERT OR IGNORE INTO push_outbox(id,notification_id,subscription_id,next_attempt_at) VALUES(?,?,?,?)',randomUUID(),id,s.id,clock())}
 return {statusLabel,describe,mutable,event,audit,tick,submitReview,confirm,addTiming,attachTiming,reviewsFor,participation,publicReview,ride,members,targets,ratingFor,enqueueExisting,pushAvailable,pushDispatch,get,all,run,tx,clock};
}

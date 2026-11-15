import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {isolatedServer} from './helpers/server.mjs';
import {lifecycle,DAY,HOUR,migrateLifecycle} from '../server/lifecycle.mjs';
import {adminApi} from '../server/admin-api.mjs';
const app=await isolatedServer();app.child.kill('SIGTERM');await new Promise(r=>app.child.once('exit',r));
const db=new DatabaseSync(app.dir+'/po-puti.sqlite');db.exec('PRAGMA foreign_keys=ON');
let time=Date.parse('2027-05-10T15:00:00Z');const base=time;
const life=lifecycle(db,{clock:()=>time});const admin=adminApi(life);
const q=(s,...a)=>db.prepare(s).get(...a),rows=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
const users=['driver','p1','p2','outsider','admin'];
for(const id of users)run('INSERT INTO users(id,username,salt,hash,name,role,created) VALUES(?,?,?,?,?,?,?)',id,id==='p1'?'passenger_one':id==='p2'?'passenger_two':id,'unused','unused',id,id==='admin'?'admin':'user',base);
const actor=id=>q('SELECT * FROM users WHERE id=?',id);
function trip({passengers=['p1'],departure=base-2*HOUR,duration=60,legacy=false}={}){
 const id=randomUUID(),eta=departure+duration*60000;
 run('INSERT INTO rides(id,driver_id,origin,destination,date,time,seats,car,created,departure_at,estimated_duration_minutes,estimated_arrival_at,eta_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,'driver','Москва','Тверь',new Date(departure).toISOString().slice(0,10),new Date(departure).toISOString().slice(11,16),3,'Lada',base,legacy?null:departure,legacy?null:duration,legacy?null:eta,legacy?'legacy_unknown':'driver_manual');
 for(const p of passengers)run('INSERT INTO requests(id,ride_id,user_id,status,created) VALUES(?,?,?,?,?)',randomUUID(),id,p,'accepted',base);
 return id;
}
try{
 const snapshots=(await readdir(app.dir+'/migration-backups')).filter(x=>x.endsWith('.sqlite'));assert.equal(snapshots.length,1);const snapshot=new DatabaseSync(app.dir+'/migration-backups/'+snapshots[0],{readOnly:true});assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert(!snapshot.prepare("SELECT name FROM sqlite_master WHERE name='pair_reviews'").get(),'backup predates schema changes');snapshot.close();
 await migrateLifecycle(db,app.dir);assert.equal(((await readdir(app.dir+'/migration-backups')).filter(x=>x.endsWith('.sqlite'))).length,1,'migration replay must not run again');
 const future=trip({departure:base+HOUR});
 time=base+HOUR-60000;assert.equal(life.describe(life.ride(future)).phase,'scheduled');assert.doesNotThrow(()=>life.mutable(life.ride(future)));
 const pending=randomUUID();run('INSERT INTO requests(id,ride_id,user_id,status,created) VALUES(?,?,?,?,?)',pending,future,'p2','pending',base);
 time=base+HOUR;assert.equal(life.describe(life.ride(future)).phase,'in_progress');assert.throws(()=>life.mutable(life.ride(future)),e=>e.status===409);life.tick();assert(q('SELECT expired_at FROM requests WHERE id=?',pending).expired_at);
 time=base+2*HOUR;assert.equal(life.describe(life.ride(future)).phase,'past');assert.equal(life.participation(life.ride(future),'p1').canConfirm,false);
 time=base+3*HOUR-60000;life.tick();assert.equal(q("SELECT COUNT(*) n FROM notifications WHERE event_key=?",'confirmation:'+future).n,0);
 time=base+3*HOUR;life.tick();life.tick();assert.equal(q("SELECT COUNT(*) n FROM notifications WHERE event_key=?",'confirmation:'+future).n,2);
 assert.equal(life.participation(life.ride(future),'p1').canConfirm,true);
 assert.throws(()=>life.confirm(actor('outsider'),{rideId:future,answer:'yes'}),e=>e.status===403);
 const yesAt=time;assert.equal(life.confirm(actor('p1'),{rideId:future,answer:'yes'}).openReview,true);assert.equal(life.ride(future).outcome,'pending_confirmation');
 time=yesAt+2*60000;const first=life.submitReview(actor('p1'),{rideId:future,score:4,body:'Точный срок'});const submitted=time;
 assert.equal(first.review.submittedAt,submitted);assert.equal(first.review.visibleAfterAt,submitted+7*DAY);assert.equal(first.review.isPublished,false);
 assert.equal(life.reviewsFor('p1',new Set()).length,1);assert.equal(life.reviewsFor('driver',new Set(['driver'])).length,0,'recipient must not read pending review');
 assert.equal(life.submitReview(actor('p1'),{rideId:future,score:1,body:'Replacement'}).id,first.id);assert.equal(q('SELECT score FROM pair_reviews WHERE id=?',first.id).score,4);
 assert.throws(()=>run('UPDATE pair_reviews SET score=1 WHERE id=?',first.id));assert.throws(()=>run('DELETE FROM pair_reviews WHERE id=?',first.id));
 time=yesAt+4*60000;life.confirm(actor('driver'),{rideId:future,answer:'yes'});assert.equal(life.ride(future).outcome,'completed');
 const second=life.submitReview(actor('driver'),{rideId:future,targetUserId:'p1',score:3,body:''});
 time=submitted+7*DAY-1;life.tick();assert.equal(life.reviewsFor('outsider',new Set(['driver'])).length,0);
 time=submitted+7*DAY;life.tick();assert.equal(life.reviewsFor('outsider',new Set(['driver'])).length,1);assert.equal(life.reviewsFor('p1',new Set(['p1'])).find(x=>x.id===second.id),undefined,'later review has its own later deadline');
 assert.equal(life.ratingFor('driver').average,4);
 time=second.review.visibleAfterAt;life.tick();assert(life.reviewsFor('p1',new Set(['p1'])).some(x=>x.id===second.id));
 // Automatic scores: no answer and no-passenger rides never create fictitious feedback.
 time=base;const automatic=trip();life.confirm(actor('driver'),{rideId:automatic,answer:'yes'});life.confirm(actor('p1'),{rideId:automatic,answer:'yes'});
 const beforeRating=life.ratingFor('driver');time=base+7*DAY-1;life.tick();assert.equal(q('SELECT COUNT(*) n FROM pair_reviews WHERE ride_id=?',automatic).n,0);
 time=base+7*DAY;life.tick();life.tick();assert.equal(q('SELECT COUNT(*) n FROM pair_reviews WHERE ride_id=?',automatic).n,2);
 const auto=q("SELECT * FROM pair_reviews WHERE ride_id=? AND author_id='p1'",automatic);assert.equal(auto.score,5);assert.equal(auto.body,'Оценка выставлена автоматически');assert.equal(auto.submitted_at,base+7*DAY);assert.equal(auto.published_at,auto.submitted_at);assert.equal(life.ratingFor('driver').average,beforeRating.average);assert.equal(life.ratingFor('driver').count,beforeRating.count);
 assert.throws(()=>life.submitReview(actor('p1'),{rideId:automatic,score:1}),e=>e.status===409);
 time=base;const absent=trip();life.confirm(actor('driver'),{rideId:absent,answer:'yes'});time=base+15*DAY;life.tick();assert.equal(life.ride(absent).outcome,'unverified');assert.equal(q('SELECT COUNT(*) n FROM pair_reviews WHERE ride_id=?',absent).n,0);
 time=base;const alone=trip({passengers:[]});life.confirm(actor('driver'),{rideId:alone,answer:'yes'});time=base+8*DAY;life.tick();assert.equal(life.ride(alone).outcome,'completed');assert.equal(q('SELECT COUNT(*) n FROM pair_reviews WHERE ride_id=?',alone).n,0);
 // Conflicting answers block publication even after seven days, until audited resolution.
 time=base;const disputed=trip({passengers:['p1','p2']});life.confirm(actor('p1'),{rideId:disputed,answer:'yes'});life.confirm(actor('driver'),{rideId:disputed,answer:'yes'});const hidden=life.submitReview(actor('p1'),{rideId:disputed,score:2,body:'Скрытый текст'});
 assert.throws(()=>life.confirm(actor('p2'),{rideId:disputed,answer:'no'}),e=>e.status===400);
 assert.equal(life.confirm(actor('p2'),{rideId:disputed,answer:'no',reason:'Не поехал'}).openReview,false);assert.equal(life.ride(disputed).outcome,'disputed');
 time=base+7*DAY;life.tick();assert(!life.reviewsFor('driver',new Set(['driver'])).some(x=>x.id===hidden.id));assert.equal(q('SELECT COUNT(*) n FROM pair_reviews WHERE ride_id=? AND source=\'automatic\'',disputed).n,0);
 assert.throws(()=>admin(actor('p1'),'/api/admin/v3/reviews','GET',{},new URLSearchParams()),e=>e.status===403);
 assert.throws(()=>admin(actor('admin'),'/api/admin/v3/rides/'+disputed+'/outcome','POST',{outcome:'completed'},new URLSearchParams()),e=>e.status===400);
 admin(actor('admin'),'/api/admin/v3/rides/'+disputed+'/outcome','POST',{outcome:'completed',reason:'Проверены доказательства'},new URLSearchParams());life.tick();assert(life.reviewsFor('driver',new Set(['driver'])).some(x=>x.id===hidden.id));
 admin(actor('admin'),'/api/admin/v3/reviews/'+hidden.id+'/block','POST',{reason:'Проверка жалобы'},new URLSearchParams());assert(!life.reviewsFor('driver',new Set(['driver'])).some(x=>x.id===hidden.id));
 admin(actor('admin'),'/api/admin/v3/reviews/'+hidden.id+'/unblock','POST',{reason:'Нарушения не выявлены'},new URLSearchParams());assert.equal(q('SELECT score FROM pair_reviews WHERE id=?',hidden.id).score,2);
 assert(q('SELECT COUNT(*) n FROM admin_audit_log').n>=3);assert.throws(()=>run("DELETE FROM admin_audit_log"));assert.throws(()=>run("UPDATE ride_confirmations SET answer='no'"));
 time=base;const denied=trip();life.confirm(actor('p1'),{rideId:denied,answer:'no',reason:'Не было поездки'});assert.equal(life.ride(denied).outcome,'pending_confirmation');life.confirm(actor('driver'),{rideId:denied,answer:'no',reason:'Не выехал'});assert.equal(life.ride(denied).outcome,'not_held');time=base+15*DAY;life.tick();assert.equal(q('SELECT COUNT(*) n FROM pair_reviews WHERE ride_id=?',denied).n,0);
 time=base;const legacy=trip({legacy:true});const oldReview=randomUUID();run('INSERT INTO reviews VALUES(?,?,?,?,?,?,?)',oldReview,legacy,'driver','p1',5,'Старый отзыв',base-20*DAY);const old=q('SELECT * FROM reviews WHERE id=?',oldReview);time=base+30*DAY;life.tick();assert.equal(q('SELECT * FROM reviews WHERE id=?',oldReview).created,old.created);assert.equal(q('SELECT COUNT(*) n FROM pair_reviews WHERE ride_id=?',legacy).n,0);assert.throws(()=>life.mutable(life.ride(legacy)),e=>e.status===409);
 // A new contradictory answer after moderation must reopen the dispute.
 time=base;const reopened=trip({passengers:['p1','p2']});life.confirm(actor('driver'),{rideId:reopened,answer:'yes'});life.confirm(actor('p1'),{rideId:reopened,answer:'yes'});
 admin(actor('admin'),'/api/admin/v3/rides/'+reopened+'/outcome','POST',{outcome:'completed',reason:'Доступные участники подтвердили'},new URLSearchParams());assert.equal(life.ride(reopened).outcome,'completed');
 life.confirm(actor('p2'),{rideId:reopened,answer:'no',reason:'Новое свидетельство после решения'});assert.equal(life.ride(reopened).outcome,'disputed');assert.equal(life.ride(reopened).outcome_override,null);
 // Manual/automatic competition at the boundary yields only one record per pair.
 time=base;const race=trip();life.confirm(actor('p1'),{rideId:race,answer:'yes'});life.confirm(actor('driver'),{rideId:race,answer:'yes'});time=base+7*DAY;
 assert.throws(()=>life.submitReview(actor('p1'),{rideId:race,score:1}),e=>e.status===409);life.tick();assert.equal(q("SELECT COUNT(*) n FROM pair_reviews WHERE ride_id=? AND author_id='p1'",race).n,1);
 const sourceRows=JSON.stringify(rows('SELECT * FROM rides'));
 const rehearsal=spawnSync(process.execPath,['scripts/validate-lifecycle-copy.mjs',app.dir+'/po-puti.sqlite',app.dir+'/private-rehearsal'],{encoding:'utf8'});
 assert.equal(rehearsal.status,0,rehearsal.stderr+rehearsal.stdout);assert.match(rehearsal.stdout,/COPY_VALIDATION_OK/);assert.equal(JSON.stringify(rows('SELECT * FROM rides')),sourceRows,'rehearsal must not change the source database');
 run('UPDATE lifecycle_schema SET version=4');await assert.rejects(()=>migrateLifecycle(db,app.dir),/Unsupported/);run('UPDATE lifecycle_schema SET version=3');
 console.log('PASS: UTC boundaries, migration backup/replay, expiry, individual review clocks, immediate eligibility, privacy, immutable/idempotent reviews, strict auto ratings, dispute/admin audit, legacy history and manual/auto race');
}finally{db.close();await app.stop()}

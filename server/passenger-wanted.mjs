import {backup,DatabaseSync} from 'node:sqlite';
import {mkdir,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fail} from './lifecycle.mjs';
import {localToUTC} from './timezones.mjs';
export async function migrateWanted(db,dir){
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='passenger_wanted_schema'").get()){if(db.prepare('SELECT MAX(version) v FROM passenger_wanted_schema').get().v!==1)throw Error('Unsupported passenger wanted schema');return;}
 const folder=join(dir,'migration-backups');await mkdir(folder,{recursive:true,mode:0o700});const file=join(folder,'before-passenger-wanted-'+randomUUID()+'.sqlite');await backup(db,file);await chmod(file,0o600);
 const copy=new DatabaseSync(file,{readOnly:true});try{if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Wanted migration backup invalid')}finally{copy.close()}
 try{db.exec(`BEGIN IMMEDIATE;
 CREATE TABLE passenger_wanted_schema(version INTEGER PRIMARY KEY);
 CREATE TABLE passenger_wanted_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)));
 INSERT INTO passenger_wanted_settings VALUES(1,1);
 CREATE TABLE passenger_wanted(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),origin TEXT NOT NULL,destination TEXT NOT NULL,date TEXT NOT NULL,time TEXT NOT NULL,time_zone TEXT NOT NULL,expires_at INTEGER NOT NULL,passengers INTEGER NOT NULL CHECK(passengers BETWEEN 1 AND 7),comment TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','cancelled','completed')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE INDEX wanted_search ON passenger_wanted(status,date,origin,destination);
 CREATE INDEX wanted_due ON passenger_wanted(status,expires_at);
 CREATE INDEX wanted_owner ON passenger_wanted(user_id,created_at);
 CREATE TABLE passenger_wanted_offers(id TEXT PRIMARY KEY,wanted_id TEXT NOT NULL REFERENCES passenger_wanted(id),ride_id TEXT NOT NULL REFERENCES rides(id),driver_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,UNIQUE(wanted_id,ride_id));
 CREATE TRIGGER wanted_erase AFTER UPDATE OF username ON users WHEN NEW.username LIKE '!deleted:%' BEGIN UPDATE passenger_wanted SET origin='',destination='',comment='',status='cancelled' WHERE user_id=NEW.id; DELETE FROM passenger_wanted_offers WHERE driver_id=NEW.id; END;
 INSERT INTO passenger_wanted_schema VALUES(1);COMMIT;`);}catch(error){db.exec('ROLLBACK');throw error}
}
export function passengerWanted(db,l,{clock=Date.now}={}){
 const get=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
 const enabled=()=>!!get('SELECT enabled FROM passenger_wanted_settings WHERE id=1').enabled;
 const tick=()=>run("UPDATE passenger_wanted SET status='completed',updated_at=? WHERE status='active' AND expires_at<=?",clock(),clock());
 const text=(v,max)=>{if(typeof v!=='string'||v.trim().length>max)throw fail('Проверьте длину текста');return v.trim()};
 const noContact=v=>{v=v.normalize('NFKC').replace(/\p{Cf}/gu,'');if(/@|https?:|www\.|t\.me|vk\.com|mailto:|(?:\+?\d[\s().-]*){7,}|(?:телефон|телеграм|telegram|whatsapp|ватсап|почта|звоните)/iu.test(v))throw fail('Не указывайте контакты в публичном тексте');return v};
 const dto=(r,actor)=>({id:r.id,from:r.origin,to:r.destination,date:r.date,time:r.time,timeZone:r.time_zone,passengers:r.passengers,comment:r.comment,status:r.status,mine:r.user_id===actor.id,offers:all(`SELECT o.id,o.ride_id rideId FROM passenger_wanted_offers o JOIN rides r ON r.id=o.ride_id JOIN users u ON u.id=r.driver_id WHERE o.wanted_id=? AND r.cancelled=0 AND r.moderation_blocked=0 AND u.blocked_at IS NULL AND r.departure_at>? ORDER BY o.created_at DESC,o.id LIMIT 50`,r.id,clock())});
 function handle(actor,path,method,data,p){
  tick();
  if(path==='/api/admin/wanted'&&method==='POST'){
   if(actor.role!=='admin')throw fail('Нет прав',403);if(typeof data.enabled!=='boolean')throw fail('Укажите состояние');
   return l.tx(()=>{const old=enabled();run('UPDATE passenger_wanted_settings SET enabled=? WHERE id=1',+data.enabled);l.audit(actor,'feature','passenger_wanted','toggle',{enabled:old},{enabled:data.enabled},'Настройка «Ищу попутку»');return {enabled:enabled()}});
  }
  if(!enabled())throw fail('Функция «Ищу попутку» отключена',403);
  if(path==='/api/wanted'&&method==='GET'){
   const mine=p.get('mine')==='1',offset=Number(p.get('offset')||0);if(!Number.isInteger(offset)||offset<0||offset>10000)throw fail('Неверная страница');
   const from=text(p.get('from')||'',100),to=text(p.get('to')||'',100),date=text(p.get('date')||'',10);
   const items=all(`SELECT w.* FROM passenger_wanted w JOIN users u ON u.id=w.user_id WHERE u.blocked_at IS NULL AND ${mine?'w.user_id=?':"w.status='active' AND ? IS NOT NULL"} AND (?='' OR casefold(w.origin)=casefold(?)) AND (?='' OR casefold(w.destination)=casefold(?)) AND (?='' OR w.date=?) ORDER BY w.created_at DESC,w.id LIMIT 51 OFFSET ?`,actor.id,from,from,to,to,date,date,offset);
   return {items:items.slice(0,50).map(r=>dto(r,actor)),nextOffset:items.length>50?offset+50:null};
  }
  if(path==='/api/wanted'&&method==='POST')return l.tx(()=>{
   const from=noContact(text(data.from,100)),to=noContact(text(data.to,100)),comment=noContact(text(data.comment||'',500)),date=text(data.date,10),time=text(data.time,5),zone=text(data.timeZone,80),passengers=Number(data.passengers);
   if(!from||!to||from.toLocaleLowerCase('ru')===to.toLocaleLowerCase('ru')||!Number.isInteger(passengers)||passengers<1||passengers>7)throw fail('Проверьте маршрут и пассажиров');
   const at=localToUTC(date,time,zone).at,expires=localToUTC(date,'23:59',zone).at+60000;
   if(at<clock()||at>clock()+180*86400000)throw fail('Выберите будущее время в пределах 180 дней');
   if(get("SELECT COUNT(*) n FROM passenger_wanted WHERE user_id=? AND status='active'",actor.id).n>=5||get('SELECT COUNT(*) n FROM passenger_wanted WHERE user_id=? AND created_at>?',actor.id,clock()-86400000).n>=10||get('SELECT 1 FROM passenger_wanted WHERE user_id=? AND created_at>?',actor.id,clock()-60000))throw fail('Лимит заявок: повторите позже',429);
   if(get("SELECT 1 FROM passenger_wanted WHERE user_id=? AND origin=? AND destination=? AND date=? AND status='active'",actor.id,from,to,date))throw fail('Такая заявка уже опубликована',409);
   const id=randomUUID();run('INSERT INTO passenger_wanted VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,actor.id,from,to,date,time,zone,expires,passengers,comment,'active',clock(),clock());return dto(get('SELECT * FROM passenger_wanted WHERE id=?',id),actor);
  });
  const m=path.match(/^\/api\/wanted\/([^/]+)\/(cancel|update|offer)$/);if(!m||method!=='POST')throw fail('Маршрут не найден',404);
  return l.tx(()=>{const w=get('SELECT * FROM passenger_wanted WHERE id=?',m[1]);if(!w)throw fail('Заявка не найдена',404);
   if(m[2]!=='offer'){
    if(w.user_id!==actor.id)throw fail('Только своя заявка',403);if(w.status!=='active'){if(m[2]==='cancel')return {ok:true};throw fail('Заявка завершена',409)}
    if(m[2]==='cancel')run("UPDATE passenger_wanted SET status='cancelled',updated_at=? WHERE id=?",clock(),w.id);
    else{const comment=noContact(text(data.comment||'',500));run('UPDATE passenger_wanted SET comment=?,updated_at=? WHERE id=?',comment,clock(),w.id)}return {ok:true};
   }
   if(get('SELECT blocked_at FROM users WHERE id=?',w.user_id)?.blocked_at||w.user_id===actor.id||w.status!=='active')throw fail('Предложение недоступно',409);
   const r=get('SELECT * FROM rides WHERE id=?',String(data.rideId||''));
   if(!r||r.driver_id!==actor.id)throw fail('Предложите собственную поездку',403);
   const occupied=get("SELECT COUNT(*) n FROM requests WHERE ride_id=? AND status='accepted'",r.id).n;
   if(r.cancelled||r.moderation_blocked||r.departure_at<=clock()||r.date!==w.date||r.origin.toLocaleLowerCase('ru')!==w.origin.toLocaleLowerCase('ru')||r.destination.toLocaleLowerCase('ru')!==w.destination.toLocaleLowerCase('ru')||r.seats-occupied<w.passengers)throw fail('Поездка не соответствует заявке',409);
   if(!get('SELECT 1 FROM passenger_wanted_offers WHERE wanted_id=? AND ride_id=?',w.id,r.id)&&get('SELECT COUNT(*) n FROM passenger_wanted_offers WHERE driver_id=? AND created_at>?',actor.id,clock()-86400000).n>=30)throw fail('Лимит предложений на сегодня',429);
   if(!get('SELECT 1 FROM passenger_wanted_offers WHERE wanted_id=? AND ride_id=?',w.id,r.id)&&get('SELECT COUNT(*) n FROM passenger_wanted_offers WHERE wanted_id=?',w.id).n>=50)throw fail('Лимит предложений для этой заявки',429);
   const id=randomUUID(),result=run('INSERT OR IGNORE INTO passenger_wanted_offers VALUES(?,?,?,?,?)',id,w.id,r.id,actor.id,clock());
   if(result.changes)l.event(w.user_id,'wanted_offer','wanted-offer:'+w.id+':'+r.id,'Предложена поездка','Посмотрите предложение водителя.','/ride/'+r.id,r.id);
   return {ok:true,repeated:!result.changes};
  });
 }
 return {enabled,tick,handle};
}

/**
 * По пути — MVP API for Android + PWA (Node 22+, built-in SQLite).
 * Shared server database, authenticated operations, and server-checked roles.
 * Demo / private test deployment, not a production hardening claim.
 * Behind an HTTPS reverse proxy; never expose this directly on the public internet.
 */
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {migrateLifecycle,lifecycle} from './lifecycle.mjs';
import {normalizePhoto} from './media.mjs';
import {migrateFeatures} from './migrations-v5.mjs';
import {rideSeries} from './ride-series.mjs';
import {safeTicketUrl,timetables} from './timetables.mjs';
import {clientConfig} from './client-config.mjs';
import {adminMfa} from './admin-mfa.mjs';
import {migrateRouting} from './migrations-v4.mjs';
import {routing} from './routing.mjs';
import {adminApi} from './admin-api.mjs';
import {createPush,pushApi,processPush} from './push.mjs';

process.umask(0o077);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WEB = resolve(ROOT, 'www');
const DATA = resolve(process.env.DATA_DIR || join(ROOT, 'server-data'));
const UPLOADS = join(DATA, 'uploads');
await mkdir(DATA, {recursive:true, mode:0o700});
await mkdir(UPLOADS, {recursive:true, mode:0o700});
const database = new DatabaseSync(join(DATA,'po-puti.sqlite'));
database.exec('PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');
database.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', car TEXT NOT NULL DEFAULT '', photo TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')), created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ride_operations(user_id TEXT NOT NULL REFERENCES users(id), client_key TEXT NOT NULL, ride_id TEXT NOT NULL REFERENCES rides(id), PRIMARY KEY(user_id,client_key));
CREATE TABLE IF NOT EXISTS rides(id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES users(id), origin TEXT NOT NULL, destination TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, seats INTEGER NOT NULL CHECK(seats BETWEEN 1 AND 7), price INTEGER, car TEXT NOT NULL, pickup TEXT NOT NULL DEFAULT '', dropoff TEXT NOT NULL DEFAULT '', luggage TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '', photo TEXT NOT NULL DEFAULT '', cancelled INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, ride_id TEXT NOT NULL REFERENCES rides(id), user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','cancelled')), created INTEGER NOT NULL, UNIQUE(ride_id,user_id));
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, ride_id TEXT NOT NULL REFERENCES rides(id), from_id TEXT NOT NULL REFERENCES users(id), to_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, message TEXT NOT NULL, ride_id TEXT, read INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, ride_id TEXT NOT NULL REFERENCES rides(id), driver_id TEXT NOT NULL REFERENCES users(id), author_id TEXT NOT NULL REFERENCES users(id), score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5), text TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(ride_id,author_id));
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, ride_id TEXT NOT NULL REFERENCES rides(id), author_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions(expires);
CREATE INDEX IF NOT EXISTS ix_requests_user ON requests(user_id);
CREATE INDEX IF NOT EXISTS ix_messages_from ON messages(from_id);
CREATE INDEX IF NOT EXISTS ix_messages_to ON messages(to_id);
CREATE INDEX IF NOT EXISTS ix_reviews_driver ON reviews(driver_id);
CREATE INDEX IF NOT EXISTS ix_rides_date ON rides(date);
CREATE INDEX IF NOT EXISTS ix_requests_ride ON requests(ride_id);
CREATE INDEX IF NOT EXISTS ix_notes_user ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS ix_messages_ride ON messages(ride_id);
`);
await migrateLifecycle(database,DATA);
await migrateRouting(database,DATA);
await migrateFeatures(database,DATA);
const roadRouter=routing(database);
const pushTransport=createPush();
const life=lifecycle(database,{pushAvailable:pushTransport.available});
const handleAdmin=adminApi(life);
const series=rideSeries(life,roadRouter),buses=timetables(database),mfa=adminMfa(database);
let stopping=false,pushInFlight=null;
function background(){
 if(stopping)return;
 try{life.tick()}catch{console.error('[lifecycle-worker] failed; see protected worker state')}
 if(pushInFlight)return;
 pushInFlight=processPush(life,pushTransport,{shouldStop:()=>stopping}).catch(()=>{life.run("UPDATE background_state SET last_error='Worker failed' WHERE name='push'");console.error('[push-worker] failed')}).finally(()=>{pushInFlight=null});
}
const lifecycleTimer=setInterval(background,60000);lifecycleTimer.unref();
background();
const q = (sql,...args) => database.prepare(sql).get(...args);
const rows = (sql,...args) => database.prepare(sql).all(...args);
const run = (sql,...args) => database.prepare(sql).run(...args);
const uid = () => crypto.randomUUID();
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const now = () => Date.now();
const clean = (value,max=120) => String(value||'').trim().slice(0,max);
const usernameValid = v=>/^[a-z0-9_-]{3,32}$/.test(v);
const passwordValid = v=>typeof v==='string' && v.length>=8 && v.length<=128;
// Let the OpenSSL worker pool perform costly password derivation. Synchronous
// scrypt in an HTTP callback blocks health checks and every other request.
const saltHash = (password,salt) => new Promise((resolve,reject)=>{
 crypto.scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(err,key)=>{
  if(err)reject(err);else resolve(key.toString('hex'));
 });
});
const jsonError=(message,status=400)=>Object.assign(new Error(message),{status});
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '';
if(PUBLIC_ORIGIN && (new URL(PUBLIC_ORIGIN).origin!==PUBLIC_ORIGIN || !PUBLIC_ORIGIN.startsWith('https://')))throw Error('PUBLIC_ORIGIN must be an HTTPS origin');
const COOKIE_NAME='poputi_session_v3';
const SESSION_MS=30*24*3600000;
const allowedOrigins = new Set((process.env.APP_ORIGINS||'https://localhost,capacitor://localhost,http://localhost:8080').split(',').map(v=>v.trim()).filter(Boolean));
const limit = new Map();
if(PUBLIC_ORIGIN)allowedOrigins.add(PUBLIC_ORIGIN);
let lastRateSweep=0;
let activeHashes=0;
async function boundedHash(password,salt){
 if(activeHashes>=4)throw jsonError('Сервер занят. Повторите позже.',503);
 activeHashes++;try{return await saltHash(password,salt)}finally{activeHashes--}
}
function requestToken(req){
 const bearer=(req.headers.authorization||'').match(/^Bearer (\S+)$/)?.[1];
 if(bearer)return bearer;
 const cookies=(req.headers.cookie||'').split(';').map(v=>v.trim());
 return cookies.find(v=>v.startsWith(COOKIE_NAME+'='))?.slice(COOKIE_NAME.length+1)||cookies.find(v=>v.startsWith('poputi_session='))?.slice('poputi_session='.length)||'';
}
function sessionCookie(token){return COOKIE_NAME+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+(token?SESSION_MS/1000:0)+(PUBLIC_ORIGIN?'; Secure':'')}

function clientIp(req){
 const peer = req.socket.remoteAddress || '';
 const forwarded = String(req.headers['x-real-ip'] || '');
 const localProxy = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer);
 return localProxy && /^[0-9a-fA-F:.]{3,45}$/.test(forwarded) ? forwarded : peer;
}
function checkRate(ip){
 const t=Date.now();
 if(t-lastRateSweep>15*60_000){
  for(const [key,entry] of limit)if(t-entry.start>15*60_000)limit.delete(key);
  lastRateSweep=t;
 }
 const r=limit.get(ip)||{start:t,count:0};
 if(t-r.start>15*60_000){r.start=t;r.count=0;}
 r.count++;limit.set(ip,r);
 if(r.count>55)throw jsonError('Слишком много попыток. Повторите позже.',429);
}
function notify(recipient,title,message,rideId='',kind='legacy',targetPath=''){const id=uid();run('INSERT INTO notifications(id,recipient_id,title,message,ride_id,read,created,target_path,kind) VALUES(?,?,?,?,?,?,?,?,?)',id,recipient,title,message,rideId,0,now(),targetPath||(rideId?'/ride/'+rideId:'/notifications'),kind);life.enqueueExisting(id)}
function transaction(fn){database.exec('BEGIN IMMEDIATE');try{const val=fn();database.exec('COMMIT');return val}catch(err){database.exec('ROLLBACK');throw err}}
function getActor(req){const token=requestToken(req);if(!token)return null;return q('SELECT u.* FROM users u INNER JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires>? AND u.blocked_at IS NULL',sha(token),now())||null;}
function requireActor(req){const actor=getActor(req);if(!actor)throw jsonError('Необходим вход в аккаунт',401);return actor;}
function requireAdmin(actor){if(actor.role!=='admin')throw jsonError('Нет прав администратора',403)}
function loggedIn(actor,req,res){const token=crypto.randomBytes(32).toString('base64url');run('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)',sha(token),actor.id,now()+SESSION_MS);const cookie=req.headers['x-po-puti-session']==='cookie';if(cookie)res.setHeader('set-cookie',sessionCookie(token));return {...(cookie?{}:{token}),user:{id:actor.id,username:actor.username,role:actor.role}}}
function rideById(id){const ride=q('SELECT * FROM rides WHERE id=?',id);if(!ride)throw jsonError('Поездка не найдена',404);return ride}
function confirmed(rideId,id1,id2){const ride=q('SELECT driver_id FROM rides WHERE id=?',rideId);return Boolean(ride&&((ride.driver_id===id1 && q("SELECT id FROM requests WHERE ride_id=? AND user_id=? AND status='accepted'",rideId,id2))||(ride.driver_id===id2&&q("SELECT id FROM requests WHERE ride_id=? AND user_id=? AND status='accepted'",rideId,id1))));}
const publicPhoto=value=>typeof value==='string'&&/^\/uploads\/[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(value)?value:'';
function publicRide(r){return {...life.describe(r),statusLabel:life.statusLabel(r),departureTimeZone:r.departure_timezone,destinationTimeZone:r.destination_timezone,routeDistanceM:r.route_distance_m,routeCalculatedAt:r.route_calculated_at,routePoints:JSON.parse(r.route_points_json||'[]'),id:r.id,driverId:r.driver_id,from:r.origin,to:r.destination,date:r.date,time:r.time,seats:r.seats,price:r.price,car:r.car,pickup:r.pickup,dropoff:r.dropoff,luggage:r.luggage,comment:r.comment,photo:publicPhoto(r.photo),seriesId:r.series_id||null,occupiedSeats:r.occupied_seats??q("SELECT COUNT(*) n FROM requests WHERE ride_id=? AND status='accepted'",r.id).n,cancelled:!!r.cancelled};}
function checkedPhoto(value, maxBytes){
 if(value===undefined||value===null||value==='')return '';
 if(typeof value!=='string'||value.length>Math.ceil(maxBytes*4/3)+80)throw jsonError('Слишком большое фото',413);
 const match=value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
 if(!match)throw jsonError('Допустимы только JPEG, PNG или WebP (HEIC преобразуйте в JPEG)');
 const bytes=Buffer.from(match[2],'base64');
 if(!bytes.length||bytes.length>maxBytes||bytes.toString('base64')!==match[2])throw jsonError('Некорректное фото или превышен размер',413);
 const jpg=match[1]==='jpeg'&&bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 const png=match[1]==='png'&&bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const webp=match[1]==='webp'&&bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!jpg&&!png&&!webp)throw jsonError('Формат изображения не соответствует файлу');
 return value;
}
async function storePhoto(value,maxBytes,ownerId){
 if(!value)return '';
 if(typeof value==='string' && /^\/uploads\/[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(value)){if(ownerId&&!q('SELECT 1 FROM media_files WHERE url=? AND owner_id=?',value,ownerId)&&!q('SELECT 1 FROM users WHERE id=? AND photo=?',ownerId,value)&&!q('SELECT 1 FROM rides WHERE driver_id=? AND photo=?',ownerId,value))throw jsonError('Это не ваше фото',403);return value;}
 let data=checkedPhoto(value,maxBytes);
 if(ownerId&&data){const bytes=await normalizePhoto(Buffer.from(data.split(',')[1],'base64'),maxBytes);data='data:image/jpeg;base64,'+bytes.toString('base64');}
 if(!data)return '';
 const match=data.match(/^data:image\/(jpeg|png|webp);base64,/);
 const ext=match[1]==='jpeg'?'jpg':match[1];
 const digest=sha(Buffer.from(data.split(',')[1],'base64'));
 if(ownerId){const old=q('SELECT url FROM media_files WHERE owner_id=? AND sha256=?',ownerId,digest);if(old)return old.url;}
 const filename=(ownerId?sha(ownerId+':'+digest).slice(0,32):crypto.randomBytes(16).toString('hex'))+'.'+ext;
 try{await writeFile(join(UPLOADS,filename),Buffer.from(data.split(',')[1],'base64'),{flag:'wx',mode:0o600})}catch(error){if(!ownerId||error.code!=='EEXIST')throw error}
 const url='/uploads/'+filename;if(ownerId){run('INSERT OR IGNORE INTO media_files VALUES(?,?,?,?,?,?)',url,ownerId,digest,'image/'+match[1],Buffer.from(data.split(',')[1],'base64').length,now());return q('SELECT url FROM media_files WHERE owner_id=? AND sha256=?',ownerId,digest).url;}return url;
}
async function migrateLegacyPhotos(){
 for(const [table,idColumn] of [['users','id'],['rides','id']]){
  const records=rows('SELECT '+idColumn+' AS id,photo FROM '+table+' WHERE photo LIKE ?', 'data:image/%');
  for(const record of records){
   try{const url=await storePhoto(record.photo,400000);run('UPDATE '+table+' SET photo=? WHERE '+idColumn+'=?',url,record.id)}
   catch(error){console.error('[photo-migration]',table,record.id,error.message)}
  }
 }
}
function isoDay(){return new Date().toISOString().slice(0,10)}
function parseBody(req){
 return new Promise((resolve,reject)=>{
  let size=0,parts=[],oversized=false;
  req.on('data',chunk=>{
   if(oversized)return;
   size+=chunk.length;
   if(size>1_100_000){
    oversized=true;parts=[];reject(jsonError('Слишком большой запрос',413));
    return; // Do not destroy the socket before the 413 response is sent.
   }
   parts.push(chunk);
  });
  req.on('end',()=>{
   if(oversized)return;
   try{
    const parsed=JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid JSON payload');
    resolve(parsed);
   }catch{reject(jsonError('Некорректные данные'))}
  });
  req.on('error',reject);
  req.on('aborted',()=>reject(jsonError('Клиент прервал запрос',400)));
 });
}
function send(res,data,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))}
function state(actor){
 // One JOIN instead of an extra blocking SQLite lookup per accepted request.
 const reqs=rows('SELECT req.*, rides.driver_id FROM requests req JOIN rides ON rides.id=req.ride_id WHERE req.user_id=? OR rides.driver_id=? ORDER BY req.created DESC',actor.id,actor.id);
 // Discovery only needs upcoming rides, while each participant keeps access
 // to their own historical rides (driver or passenger). This bounds growth of
 // unrelated historical car photos in each recurring /state response.
 const rides=rows("SELECT rides.*, (SELECT COUNT(*) FROM requests WHERE ride_id=rides.id AND status='accepted') occupied_seats FROM rides WHERE ((departure_at>=? OR (departure_at IS NULL AND date>=?)) AND moderation_blocked=0 AND driver_id IN (SELECT id FROM users WHERE blocked_at IS NULL)) OR driver_id=? OR id IN (SELECT ride_id FROM requests WHERE user_id=?) ORDER BY date,time",now(),isoDay(),actor.id,actor.id).map(r=>({...publicRide(r),statusLabel:life.statusLabel(r,actor.id)}));
 const visibleIds=new Set([actor.id,...rides.map(r=>r.driverId)]);
 const peers=new Set([actor.id]);
 for(const r of reqs){
  visibleIds.add(r.user_id);
  if(r.status==='accepted'){
   visibleIds.add(r.driver_id);
   peers.add(r.driver_id);
   peers.add(r.user_id);
  }
 }
 // SQL must filter visible accounts BEFORE reading potentially large avatar BLOBs.
 // Keep chunks below SQLite bind parameter limits without changing the API shape.
 const visible=[...visibleIds];
 const users=[];
 for(let i=0;i<visible.length;i+=400){
  const batch=visible.slice(i,i+400);
  const placeholders=batch.map(()=>'?').join(',');
  for(const u of rows('SELECT id,username,name,phone,car,photo,role FROM users WHERE id IN ('+placeholders+')',...batch)){
   users.push({...u,rating:life.ratingFor(u.id),photo:publicPhoto(u.photo),phone:peers.has(u.id)?u.phone:''});
  }
 }
 const notifications=rows('SELECT * FROM notifications WHERE recipient_id=? ORDER BY created DESC LIMIT 300',actor.id).map(n=>({id:n.id,to:n.recipient_id,title:n.title,message:n.message,rideId:n.ride_id,read:!!n.read,readAt:n.read_at,created:n.created,kind:n.kind,targetPath:n.target_path}));
 // Only expose reviews belonging to drivers in this user's visible rides.
 // Global review scans made unrelated historical data part of every /state poll.
 const visibleReviews=[];
 for(let i=0;i<visible.length;i+=400){
  const batch=visible.slice(i,i+400);
  const placeholders=batch.map(()=>'?').join(',');
  visibleReviews.push(...rows("SELECT r.*,u.name author,COALESCE((SELECT status FROM legacy_review_moderation WHERE review_id=r.id),'allowed') moderation_status FROM reviews r JOIN users u ON u.id=r.author_id WHERE (COALESCE((SELECT status FROM legacy_review_moderation WHERE review_id=r.id),'allowed')='allowed' AND r.driver_id IN ("+placeholders+")) OR r.author_id=? ORDER BY r.created DESC",...batch,actor.id));
 }
 visibleReviews.sort((a,b)=>b.created-a.created);
 const reviews=[...new Map(visibleReviews.map(r=>[r.id,r])).values()].map(r=>({id:r.id,rideId:r.ride_id,driverId:r.driver_id,authorId:r.author_id,author:r.author,score:r.score,text:r.text,moderationStatus:r.moderation_status,date:new Date(r.created).toISOString().slice(0,10)}));
 const messages=rows('SELECT * FROM messages WHERE from_id=? OR to_id=? ORDER BY created DESC LIMIT 1000',actor.id,actor.id).map(m=>({id:m.id,rideId:m.ride_id,fromId:m.from_id,toId:m.to_id,text:m.text,created:m.created}));
 return {decisions:rows("SELECT d.id,d.ride_id rideId,d.report_id reportId,d.decision,d.comment,d.created_at createdAt FROM moderation_decisions d JOIN rides r ON r.id=d.ride_id WHERE r.driver_id=? OR EXISTS(SELECT 1 FROM requests WHERE ride_id=r.id AND user_id=? AND status='accepted') OR EXISTS(SELECT 1 FROM reports WHERE id=d.report_id AND author_id=?) ORDER BY d.created_at DESC LIMIT 100",actor.id,actor.id,actor.id),serverNow:now(),currentUserId:actor.id,users,rides,requests:reqs.filter(r=>r.user_id===actor.id||life.describe(rideById(r.ride_id)).phase==='scheduled').map(r=>({id:r.id,rideId:r.ride_id,userId:r.user_id,status:r.expired_at?'expired':r.status,created:r.created})),notifications,unreadCount:q('SELECT COUNT(*) n FROM notifications WHERE recipient_id=? AND read=0',actor.id).n,reviews:[...reviews.map(r=>({...r,source:'legacy',isAuto:false,isPublished:r.moderationStatus!=='blocked'})),...life.reviewsFor(actor.id,visibleIds)],messages,reports:rows('SELECT id,ride_id rideId,reason,details,status,decision,created FROM reports WHERE author_id=? ORDER BY created DESC LIMIT 100',actor.id),participations:rides.filter(r=>r.driverId===actor.id||reqs.some(q=>q.ride_id===r.id&&q.user_id===actor.id&&q.status==='accepted')).map(r=>life.participation(rideById(r.id),actor.id))};
}
function cancelRide(ride,actor,asAdmin=false,reason=''){life.mutable(ride);if(asAdmin&&(!reason||typeof reason!=='string'))throw jsonError('Укажите причину отмены');if(ride.driver_id!==actor.id&&!asAdmin)throw jsonError('Недостаточно прав',403);if(ride.cancelled)throw jsonError('Поездка уже отменена',409);transaction(()=>{if(asAdmin)life.audit(actor,'ride',ride.id,'cancel',{cancelled:false},{cancelled:true},reason);run('UPDATE rides SET cancelled=1 WHERE id=?',ride.id);if(ride.series_id)run('INSERT OR IGNORE INTO ride_series_exceptions VALUES(?,?,?)',ride.series_id,ride.date,'Водитель отменил эту дату');for(const r of rows("SELECT * FROM requests WHERE ride_id=? AND status IN ('pending','accepted')",ride.id)){run("UPDATE requests SET status='cancelled' WHERE id=?",r.id);notify(r.user_id,'Поездка отменена',`${ride.origin} → ${ride.destination}: поездка отменена`,ride.id,'ride_cancelled')}});return {ok:true};}
async function handleApi(req,res,path,data){const method=req.method;
 if(path==='/api/health' && method==='GET')return {ok:q('SELECT 1 AS ok').ok===1,backend:'sqlite',version:'0.2',release:process.env.RELEASE_SHA||'development'};
 if(path==='/api/public-config'&&method==='GET')return {privacy:clientConfig().privacy};
 if(path==='/api/register' && method==='POST'){
   checkRate(clientIp(req));if(data.clientVersion===5&&data.termsAccepted!==true)throw jsonError('Подтвердите согласие с условиями обработки данных');const uname=clean(data.username,33).toLowerCase();if(!usernameValid(uname)||!passwordValid(data.password))throw jsonError('Логин должен содержать 3–32 символа, пароль — не менее 8');
   if(q('SELECT id FROM users WHERE username=?',uname))throw jsonError('Этот логин уже занят',409);
   const id=uid(),salt=crypto.randomBytes(20).toString('hex'),hash=await boundedHash(data.password,salt);try{run('INSERT INTO users(id,username,salt,hash,name,role,created) VALUES(?,?,?,?,?,?,?)',id,uname,salt,hash,uname,'user',now())}catch(error){if(q('SELECT id FROM users WHERE username=?',uname))throw jsonError('Этот логин уже занят',409);throw error}
   if(data.termsAccepted===true)run('INSERT INTO privacy_consents VALUES(?,?,?,?,?)',id,'terms',clientConfig().privacy.policyVersion,1,now());return loggedIn(q('SELECT * FROM users WHERE id=?',id),req,res);
 }
 if(path==='/api/login' && method==='POST'){
   checkRate(clientIp(req));if(!passwordValid(data.password))throw jsonError('Неверный логин или пароль',401);const uname=clean(data.username,33).toLowerCase();const user=q('SELECT * FROM users WHERE username=?',uname);
   const salt=user?.salt||'no-user-salt',expected=user?.hash||'0'.repeat(128),actual=await boundedHash(data.password,salt);
   if(user?.blocked_at)throw jsonError('Аккаунт заблокирован',403);
   if(!user||!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(actual,'hex')))throw jsonError('Неверный логин или пароль',401);
   if(user.role==='admin'&&mfa.get(user.id)?.enabled)mfa.verify(user.id,data.mfaCode);
   const session=loggedIn(user,req,res);if(user.role==='admin'&&mfa.get(user.id)?.enabled)run('UPDATE sessions SET mfa_verified_at=? WHERE token_hash=?',now(),sha(session.token||String(res.getHeader('set-cookie')).split(';')[0].split('=')[1]));return session;
 }
 const actor=requireActor(req);
 life.tick();
 const params=new URL(req.url,'http://localhost').searchParams;
 if(path.startsWith('/api/admin/')){requireAdmin(actor);if(mfa.required()&&path!=='/api/admin/mfa/enroll'&&path!=='/api/admin/mfa/verify'&&!q('SELECT mfa_verified_at FROM sessions WHERE token_hash=?',sha(requestToken(req)))?.mfa_verified_at)throw jsonError('Требуется подтверждение MFA',403);}
 if(path==='/api/admin/v4/routing'&&method==='GET')return {...roadRouter.capabilities(),diagnostics:roadRouter.diagnostics(),missingEta:q('SELECT COUNT(*) n FROM rides WHERE estimated_arrival_at IS NULL').n};
 if(method==='POST'&&['/api/rides','/api/series','/api/requests','/api/messages','/api/profile','/api/reports','/api/complaints'].includes(path))checkRate('write:'+path+':'+actor.id);
 if(path==='/api/client-config'&&method==='GET')return {...clientConfig(),timetables:buses.status()};
 if(path==='/api/admin/mfa/enroll'&&method==='POST'){requireAdmin(actor);checkRate('mfa:'+actor.id);if(!passwordValid(data.password)||!crypto.timingSafeEqual(Buffer.from(actor.hash,'hex'),Buffer.from(await boundedHash(data.password,actor.salt),'hex')))throw jsonError('Неверный пароль',401);return mfa.enroll(actor)}
 if(path==='/api/admin/mfa/verify'&&method==='POST'){requireAdmin(actor);checkRate('mfa:'+actor.id);mfa.verify(actor.id,data.code,true);run('UPDATE sessions SET mfa_verified_at=? WHERE token_hash=?',now(),sha(requestToken(req)));return {ok:true}}
 if(path==='/api/privacy/consent'&&method==='POST'){if(typeof data.granted!=='boolean'||data.category!=='advertising')throw jsonError('Неверное согласие');run('INSERT INTO privacy_consents VALUES(?,?,?,?,?) ON CONFLICT(user_id,category) DO UPDATE SET version=excluded.version,granted=excluded.granted,updated_at=excluded.updated_at',actor.id,data.category,clientConfig().privacy.policyVersion,Number(data.granted),now());return {ok:true}}
 if(path==='/api/account/deletion-request'&&method==='POST'){if(data.confirmation!=='DELETE_MY_ACCOUNT')throw jsonError('Подтвердите запрос удаления аккаунта');run('INSERT OR IGNORE INTO deletion_requests VALUES(?,?,?)',actor.id,now(),'pending');return {ok:true,status:'pending',message:'Запрос зарегистрирован. Данные не удаляются до применения согласованной политики хранения.'}}
 if(path==='/api/series'&&method==='GET')return series.list(actor);
 const seriesAction=path.match(/^\/api\/series\/([^/]+)\/(cancel|update)$/);if(seriesAction&&method==='POST'){checkRate('series-edit:'+actor.id);return seriesAction[2]==='cancel'?series.cancel(actor,seriesAction[1]):series.update(actor,seriesAction[1],data)}
 if(path==='/api/search/places'&&method==='GET'){checkRate('rasp-places:'+actor.id);return buses.places(params.get('q'))}
 if(path==='/api/search'&&method==='GET'){
  checkRate('search:'+actor.id);const kind=params.get('type')||'all';if(!['all','private','bus'].includes(kind))throw jsonError('Неизвестный тип поиска');
  const from=clean(params.get('from'),100),to=clean(params.get('to'),100),date=clean(params.get('date'),10),offset=Number(params.get('offset')||0);if(!Number.isInteger(offset)||offset<0||offset>10000)throw jsonError('Неверная страница');
  const a=buses.resolve(from),b=buses.resolve(to);const sourceFrom=a?.title||from,sourceTo=b?.title||to;
  const privateRides=kind==='bus'?[]:rows("SELECT r.*, (SELECT COUNT(*) FROM requests WHERE ride_id=r.id AND status='accepted') occupied_seats FROM rides r JOIN users u ON u.id=r.driver_id WHERE r.cancelled=0 AND r.moderation_blocked=0 AND u.blocked_at IS NULL AND (r.departure_at>? OR (r.departure_at IS NULL AND r.date>=?)) AND (?='' OR r.origin=? COLLATE NOCASE) AND (?='' OR r.destination=? COLLATE NOCASE) AND (?='' OR r.date=?) AND r.seats>(SELECT COUNT(*) FROM requests WHERE ride_id=r.id AND status='accepted') ORDER BY r.date,r.time,r.id LIMIT 51 OFFSET ?",now(),isoDay(),sourceFrom,sourceFrom,sourceTo,sourceTo,date,date,offset).map(r=>({type:'private_ride',...publicRide(r)}));
  const bus=kind==='private'?{items:[],status:'not_requested'}:await buses.search({from,to,date,offset});return {private:{items:privateRides.slice(0,50),nextOffset:privateRides.length>50?offset+50:null,status:privateRides.length?'ok':'empty'},bus};
 }
 if(path==='/api/admin/bus-catalog'&&method==='POST'){requireAdmin(actor);if(process.env.RASP_LICENSE_CONFIRMED!=='true')throw jsonError('Сначала подтвердите условия использования справочника',409);return buses.importCatalog(data)}
 if(path==='/api/admin/bus-purchase'&&method==='POST'){requireAdmin(actor);const source=buses.resolve(data.fromCode),destination=buses.resolve(data.toCode);const url=String(data.url||''),cashier=clean(data.cashier,500),sourceUrl=String(data.sourceUrl||'');if(!source||!destination||!data.threadUid||!/^\d{4}-\d{2}-\d{2}$/.test(data.date)||(!url&&!cashier)||!/^https:\/\//.test(sourceUrl)||!Number.isFinite(Number(data.validUntil))||Number(data.validUntil)<=now()||Number(data.validUntil)>now()+31*86400000)throw jsonError('Укажите проверенный рейс, источник и срок актуальности');if(url&&!safeTicketUrl(url))throw jsonError('Недопустимая ссылка');return transaction(()=>{life.audit(actor,'bus_purchase',String(data.threadUid),'verify',null,{date:data.date},data.reason);run('INSERT INTO bus_purchase_info VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(thread_uid,service_date,from_code,to_code) DO UPDATE SET url=excluded.url,cashier=excluded.cashier,source_url=excluded.source_url,verified_by=excluded.verified_by,verified_at=excluded.verified_at,valid_until=excluded.valid_until',uid(),clean(data.threadUid),data.date,source.code,destination.code,url,cashier,sourceUrl,actor.id,now(),Number(data.validUntil));return {ok:true}})}
 if(path==='/api/routing/config'&&method==='GET')return roadRouter.capabilities();
 if(path==='/api/places'&&method==='GET'){checkRate('places:'+actor.id);return roadRouter.places(params.get('q'))}
 if(path==='/api/routes/estimate'&&method==='POST'){checkRate('routing:'+actor.id);return roadRouter.estimate(actor,data)}
 if(path.startsWith('/api/admin/v3/')){requireAdmin(actor);if(method==='POST')checkRate('admin:'+actor.id);return handleAdmin(actor,path,method,data,params)}
 if(/^\/api\/reviews(?:\/|$)/.test(path)&&['PUT','PATCH','DELETE'].includes(method))throw jsonError('Отправленный отзыв нельзя изменить или удалить',409);
 if(path.startsWith('/api/push/')){const result=pushApi(life,actor,path,method,data);if(result)return result}
 if(path==='/api/confirmations'&&method==='POST')return life.confirm(actor,data);
 if(path==='/api/reviews'&&method==='POST')return life.submitReview(actor,data);
 if(path==='/api/reviews/mine'&&method==='GET')return {reviews:[...life.reviewsFor(actor.id,new Set()).filter(r=>r.authorId===actor.id),...rows("SELECT v.id,v.ride_id rideId,v.driver_id driverId,v.author_id authorId,v.score,v.text,v.created submittedAt,COALESCE(m.status,'allowed') moderationStatus,'legacy' source FROM reviews v LEFT JOIN legacy_review_moderation m ON m.review_id=v.id WHERE author_id=?",actor.id).map(r=>({...r,isAuto:false,isPublished:r.moderationStatus==='allowed'}))]};
 if(path==='/api/reviews/public'&&method==='GET'){const id=params.get('userId')||actor.id;return {reviews:life.reviewsFor('',new Set([id])),legacy:rows("SELECT id,ride_id rideId,driver_id driverId,author_id authorId,score,text,created FROM reviews WHERE driver_id=? AND COALESCE((SELECT status FROM legacy_review_moderation WHERE review_id=reviews.id),'allowed')='allowed'",id)}}
 if(path==='/api/notifications'&&method==='GET')return {items:state(actor).notifications,unreadCount:q('SELECT COUNT(*) n FROM notifications WHERE recipient_id=? AND read=0',actor.id).n};
 if(path==='/api/notifications/read-all'&&method==='POST'){run('UPDATE notifications SET read=1,read_at=COALESCE(read_at,?) WHERE recipient_id=?',now(),actor.id);return {ok:true}}
 if(path==='/api/complaints'&&method==='GET')return {items:state(actor).reports};
 if(path==='/api/session'&&method==='POST'){const result=loggedIn(actor,req,res);run('DELETE FROM sessions WHERE token_hash=?',sha(requestToken(req)));return result;}
 if(path==='/api/state'&&method==='GET'){if(!req.headers.authorization)res.setHeader('set-cookie',sessionCookie(requestToken(req)));return state(actor)}
 if(path==='/api/logout'&&method==='POST'){const token=requestToken(req);res.setHeader('set-cookie',[sessionCookie(''),'poputi_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0'+(PUBLIC_ORIGIN?'; Secure':'')]);if(data.deviceId)pushApi(life,actor,'/api/push/unsubscribe','POST',data);run('DELETE FROM sessions WHERE token_hash=?',sha(token));return {ok:true}}
 if(path==='/api/profile'&&method==='POST'){
   const name=clean(data.name,60),car=clean(data.car,90),phone=clean(data.phone,24);
   if(!name)throw jsonError('Укажите имя');
   if(phone&&!/^[+\d ()-]{7,24}$/.test(phone))throw jsonError('Неверный формат телефона');
   const photo=Object.hasOwn(data,'photo')?await storePhoto(data.photo,300000,actor.id):actor.photo||'';
   run('UPDATE users SET name=?,car=?,phone=?,photo=? WHERE id=?',name,car,phone,photo,actor.id);return {ok:true};
 }
 if((path==='/api/rides'||path==='/api/series')&&method==='POST'){
   const retryKey=clean(data.clientKey,80);if(retryKey&&/^[a-zA-Z0-9_-]{10,80}$/.test(retryKey)){const old=q('SELECT ride_id FROM ride_operations WHERE user_id=? AND client_key=?',actor.id,retryKey);if(old)return {id:old.ride_id,repeated:true};}
   const routePlan=roadRouter.prepare(actor,data);const timing=routePlan?null:life.addTiming(data);
   const from=clean(data.from,100),to=clean(data.to,100),date=clean(data.date,10),time=clean(data.time,5),car=clean(data.car,90);
   const seats=Number(data.seats),price=data.negotiable?null:Number(data.price);
    const validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
    const validTime=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
   if(!from||!to||from.toLowerCase()===to.toLowerCase()||!validDate||!validTime||(!timing&&!routePlan&&date<isoDay())||!Number.isInteger(seats)||seats<1||seats>7||(!data.negotiable&&(!Number.isInteger(price)||price<0||price>100000))||!car)throw jsonError('Проверьте маршрут, дату, места, стоимость и автомобиль');
   const key=clean(data.clientKey,80);if(key&&!/^[a-zA-Z0-9_-]{10,80}$/.test(key))throw jsonError('Неверный идентификатор операции');
   if(key){const prev=q('SELECT ride_id FROM ride_operations WHERE user_id=? AND client_key=?',actor.id,key);if(prev)return {id:prev.ride_id,repeated:true};}
   const photo=await storePhoto(data.photo,120000,actor.id);
   if(path==='/api/series')return series.create(actor,data,(date,plan,seriesId)=>{const id=uid();run('INSERT INTO rides(id,driver_id,origin,destination,date,time,seats,price,car,pickup,dropoff,luggage,comment,photo,cancelled,created,series_id,service_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)',id,actor.id,from,to,date,time,seats,price,car,clean(data.pickup,150),clean(data.dropoff,150),clean(data.luggage,60),clean(data.comment,550),photo,now(),seriesId,date);roadRouter.attach(id,actor,plan);return id});
   return transaction(()=>{
   if(q('SELECT blocked_at FROM users WHERE id=?',actor.id)?.blocked_at)throw jsonError('Аккаунт заблокирован',403);
   // File writes yield the event loop: another request may have committed this key.
   if(key){const prev=q('SELECT ride_id FROM ride_operations WHERE user_id=? AND client_key=?',actor.id,key);if(prev)return {id:prev.ride_id,repeated:true};}
   if(timing)life.addTiming(data);if(routePlan)roadRouter.prepare(actor,data);const id=uid();run('INSERT INTO rides(id,driver_id,origin,destination,date,time,seats,price,car,pickup,dropoff,luggage,comment,photo,cancelled,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,actor.id,from,to,date,time,seats,price,car,clean(data.pickup,150),clean(data.dropoff,150),clean(data.luggage,60),clean(data.comment,550),photo,0,now());life.attachTiming(id,timing);roadRouter.attach(id,actor,routePlan);if(key)run('INSERT INTO ride_operations VALUES(?,?,?)',actor.id,key,id);return {id};});
 }
 if(path==='/api/requests'&&method==='POST'){
   const ride=rideById(clean(data.rideId,100));life.mutable(ride);if(ride.cancelled||ride.driver_id===actor.id)throw jsonError('Нельзя отправить заявку на эту поездку',409);
   return transaction(()=>{if(q('SELECT id FROM requests WHERE ride_id=? AND user_id=?',ride.id,actor.id))throw jsonError('Вы уже отправили заявку на поездку',409);
     const occupied=q("SELECT COUNT(*) n FROM requests WHERE ride_id=? AND status='accepted'",ride.id).n;if(occupied>=ride.seats)throw jsonError('Свободных мест больше нет',409);
     const id=uid();run('INSERT INTO requests(id,ride_id,user_id,status,created) VALUES(?,?,?,?,?)',id,ride.id,actor.id,'pending',now());notify(ride.driver_id,'Новая заявка',`${actor.name} хочет поехать: ${ride.origin} → ${ride.destination}`,ride.id,'booking_created');return {id};});
 }
 const routeEdit=path.match(/^\/api\/rides\/([^/]+)\/route$/);
 if(routeEdit&&method==='POST'){const trip=rideById(routeEdit[1]);if(trip.driver_id!==actor.id)throw jsonError('Изменение маршрута доступно только водителю',403);life.mutable(trip);if(trip.series_id&&q("SELECT id FROM requests WHERE ride_id=? AND status IN ('pending','accepted')",trip.id))throw jsonError('Для этой даты есть заявки. Перенос требует отмены и повторного бронирования.',409);const reason=clean(data.reason,1000);if(!reason)throw jsonError('Укажите причину изменения маршрута');const plan=roadRouter.prepare(actor,data);if(!plan)throw jsonError('Пересчитайте дорожный маршрут или укажите ручную длительность и часовые пояса');const from=clean(data.from,100),to=clean(data.to,100);if(!from||!to||from===to)throw jsonError('Проверьте маршрут');return transaction(()=>{life.mutable(rideById(trip.id));run('UPDATE rides SET origin=?,destination=?,date=?,time=?,pickup=?,dropoff=? WHERE id=?',from,to,data.date,data.time,clean(data.pickup,150),clean(data.dropoff,150),trip.id);roadRouter.attach(trip.id,actor,plan,reason);for(const person of life.members(trip))life.event(person,'route_changed','route-change:'+uid(),'Маршрут обновлён','Водитель обновил маршрут или время отправления.','/ride/'+trip.id,trip.id);return {id:trip.id}})}
 const cancelledRequest=path.match(/^\/api\/requests\/([^/]+)\/cancel$/);
 if(cancelledRequest&&method==='POST'){
  const request=q('SELECT * FROM requests WHERE id=?',cancelledRequest[1]);if(!request)throw jsonError('Заявка не найдена',404);
  if(request.user_id!==actor.id)throw jsonError('Это не ваша заявка',403);
  const trip=rideById(request.ride_id);life.mutable(trip);
  if(!['pending','accepted'].includes(request.status)||request.expired_at)throw jsonError('Заявка уже закрыта',409);
  return transaction(()=>{run("UPDATE requests SET status='cancelled' WHERE id=?",request.id);notify(trip.driver_id,'Бронирование отменено','Пассажир отменил заявку до отправления.',trip.id,'booking_cancelled');return {ok:true}});
 }
 let m=path.match(/^\/api\/requests\/([^/]+)\/(accept|reject)$/);
 if(m&&method==='POST'){
   const reqst=q('SELECT * FROM requests WHERE id=?',m[1]);if(!reqst)throw jsonError('Заявка не найдена',404);
   const ride=rideById(reqst.ride_id);life.mutable(ride);if(ride.driver_id!==actor.id)throw jsonError('Вы не владелец поездки',403);
   return transaction(()=>{const fresh=q('SELECT * FROM requests WHERE id=?',m[1]);if(fresh.status!=='pending'||ride.cancelled)throw jsonError('Заявка уже обработана или поездка отменена',409);
     if(m[2]==='accept'&&q("SELECT COUNT(*) n FROM requests WHERE ride_id=? AND status='accepted'",ride.id).n>=ride.seats)throw jsonError('Свободных мест больше нет',409);
     const status=m[2]==='accept'?'accepted':'rejected';run('UPDATE requests SET status=? WHERE id=?',status,m[1]);notify(fresh.user_id,status==='accepted'?'Заявка подтверждена':'Заявка отклонена',`${ride.origin} → ${ride.destination}: ${status==='accepted'?'водитель принял вашу заявку':'водитель отклонил вашу заявку'}`,ride.id,'booking_status');return {ok:true,status};});
 }
 m=path.match(/^\/api\/rides\/([^/]+)\/cancel$/);if(m&&method==='POST')return cancelRide(rideById(m[1]),actor);
 m=path.match(/^\/api\/admin\/rides\/([^/]+)\/cancel$/);if(m&&method==='POST'){requireAdmin(actor);return cancelRide(rideById(m[1]),actor,true,data.reason)}
 m=path.match(/^\/api\/notifications\/([^/]+)\/read$/);if(m&&method==='POST'){run('UPDATE notifications SET read=1,read_at=COALESCE(read_at,?) WHERE id=? AND recipient_id=?',now(),m[1],actor.id);return {ok:true}}
 if(path==='/api/messages'&&method==='POST'){
   const rideId=clean(data.rideId,100),toId=clean(data.toId,100),txt=clean(data.text,1200);if(!txt||!confirmed(rideId,actor.id,toId))throw jsonError('Чат доступен только участникам подтверждённой поездки',403);
   const id=uid();run('INSERT INTO messages VALUES(?,?,?,?,?,?)',id,rideId,actor.id,toId,txt,now());notify(toId,'Новое сообщение',txt.slice(0,120),rideId,'chat_message','/chat/'+rideId+'/'+actor.id);return {id};
 }
 if((path==='/api/reports'||path==='/api/complaints')&&method==='POST'){
  const trip=rideById(clean(data.rideId,100)),reason=clean(data.reason,100),details=clean(data.details,500),category=data.category==='ride_fact'?'ride_fact':'general';
  if(!reason)throw jsonError('Выберите причину жалобы');
  if(category==='ride_fact'&&!life.members(trip).includes(actor.id))throw jsonError('Обращение о факте поездки доступно участнику',403);
  return transaction(()=>{const id=uid();run('INSERT INTO reports(id,ride_id,author_id,reason,details,created,category) VALUES(?,?,?,?,?,?,?)',id,trip.id,actor.id,reason,details,now(),category);
   if(category==='ride_fact')run("UPDATE rides SET outcome='disputed',outcome_override=NULL WHERE id=?",trip.id);
   for(const admin of rows("SELECT id FROM users WHERE role='admin' AND blocked_at IS NULL"))life.event(admin.id,'complaint','complaint:'+id,'Новое обращение','Откройте очередь модерации.','/admin',trip.id);
   return {ok:true,id};});
 }
 if(path==='/api/admin/overview'&&method==='GET'){
   requireAdmin(actor);return {users:rows('SELECT id,username,name,role FROM users ORDER BY created DESC'),rides:rows('SELECT * FROM rides ORDER BY created DESC LIMIT 100').map(publicRide),requests:rows('SELECT id,ride_id,user_id,status FROM requests ORDER BY created DESC LIMIT 100'),reports:rows('SELECT id,ride_id rideId,reason,details,created FROM reports ORDER BY created DESC LIMIT 100')};
 }
 throw jsonError('Маршрут API не найден',404);
}
// Direct links to application screens must load the SPA shell, not JSON 404.
const appScreen = /^\/(?:login|search|publish|trips|notifications|profile|my-reviews|complaints|admin|ride\/[^/]+|reviews\/[^/]+|chat\/[^/]+\/[^/]+)\/?$/;
async function serveStatic(req,res,pathname){
 let path=pathname==='/'?'/index.html':pathname;
 try{path=decodeURIComponent(path)}catch{throw jsonError('Неверный путь',400)}
 if(path==='/admin'||path==='/admin/'){const actor=requireActor(req);requireAdmin(actor)}
 if(appScreen.test(path) && String(req.headers.accept||'').includes('text/html')) path='/index.html';
 if(path.startsWith('/uploads/')){
   const name=path.slice('/uploads/'.length);
   if(!/^[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(name))throw jsonError('Файл не найден',404);
   const file=join(UPLOADS,name);if(!existsSync(file))throw jsonError('Файл не найден',404);
   const body=await readFile(file),type=name.endsWith('.jpg')?'image/jpeg':name.endsWith('.png')?'image/png':'image/webp';
   res.writeHead(200,{'content-type':type,'cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff','content-length':body.length});res.end(req.method==='HEAD'?undefined:body);return;
 }
 const file=resolve(WEB,'.'+path);
 if(!file.startsWith(WEB+sep))throw jsonError('Доступ запрещён',403);
 if(!existsSync(file)){
   // Path only: do not log query strings, passwords or auth headers.
   if(String(req.headers.accept||'').includes('text/html')) console.warn('[navigation-404]',req.method,pathname.slice(0,180));
   throw jsonError('Файл не найден',404);
 }
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
 const body=await readFile(file);
 if(file===join(WEB,'index.html')){
  const inline=body.toString('utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const hash=crypto.createHash('sha256').update(inline||'').digest('base64');
  const adOrigins=process.env.ADS_ENABLED==='true'&&process.env.ADS_TERMS_CONFIRMED==='true'?String(process.env.ADS_WEB_CSP_ORIGINS||'').split(',').map(s=>s.trim()).filter(s=>{try{const u=new URL(s);return !s.includes('*')&&u.protocol==='https:'&&u.origin===s&&!u.username&&!u.password}catch{return false}}).join(' '):'';
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self' 'sha256-"+hash+"' "+adOrigins+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: "+adOrigins+"; connect-src 'self' "+adOrigins+"; frame-src https://yandex.ru https://yandex.st https://yastatic.net "+adOrigins+"; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
 }
 res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','x-content-type-options':'nosniff','cache-control':extname(file)==='.html'?'no-store':'no-cache','content-length':body.length});
 res.end(req.method==='HEAD'?undefined:body);
}
const server=http.createServer(async(req,res)=>{
 const startTime=Date.now();
 try{
 const reqUrl=new URL(req.url,'http://localhost');const origin=req.headers.origin;
 const originAllowed=allowedOrigins.has(origin)||origin===(PUBLIC_ORIGIN||'http://'+req.headers.host);
 // Log only slow/aborted API requests, never tokens, IPs, URLs with query or bodies.
 if(reqUrl.pathname.startsWith('/api/')){
  res.on('finish',()=>{
   const ms=Date.now()-startTime;
   if(ms>=2000||res.statusCode>=500)console.warn('[api-slow]',req.method,reqUrl.pathname,res.statusCode,ms+'ms');
  });
  res.on('close',()=>{
   if(!res.writableFinished)console.warn('[api-aborted]',req.method,reqUrl.pathname,Date.now()-startTime+'ms');
  });
 }
 if(origin&&originAllowed){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');res.setHeader('access-control-allow-headers','Content-Type, Authorization, X-Po-Puti-Session');res.setHeader('access-control-allow-methods','GET, POST, OPTIONS')}
 res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','strict-origin-when-cross-origin');
 res.setHeader('x-frame-options','DENY');
 res.setHeader('permissions-policy','camera=(), microphone=(), geolocation=()');
 if(reqUrl.pathname.startsWith('/api/')&&req.method==='POST'){
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw jsonError('Требуется application/json',415);
  // Cookies require same-origin requests; native/API callers use Bearer auth.
  if((requestToken(req)&&!req.headers.authorization)||req.headers['x-po-puti-session']==='cookie'){
   if(req.headers['sec-fetch-site']==='cross-site')throw jsonError('Запрос с другого сайта запрещён',403);
   const expected=PUBLIC_ORIGIN||'http://'+req.headers.host;
   if(origin&&origin!==expected)throw jsonError('Origin не разрешён для cookie-сессии',403);
  }
 }
  if(req.method==='OPTIONS'){res.writeHead(origin&&!originAllowed?403:204);res.end();return;}
  if(origin&&!originAllowed&&reqUrl.pathname.startsWith('/api/'))throw jsonError('Origin не разрешён',403);
  if(reqUrl.pathname==='/config.js'&&(req.method==='GET'||req.method==='HEAD')){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:'window.PO_PUTI_BACKEND = true;');return;}
  if(reqUrl.pathname.startsWith('/api/')){const data=req.method==='POST'?await parseBody(req):{};const output=await handleApi(req,res,reqUrl.pathname,data);send(res,output);return;}
  if(req.method==='GET'||req.method==='HEAD')return await serveStatic(req,res,reqUrl.pathname);
  throw jsonError('Метод не поддерживается',405);
 }catch(error){if(!res.headersSent){send(res,{error:error.status?error.message:'Внутренняя ошибка сервера'},error.status||500)}else res.end();if(!error.status)console.error(error)}
});
server.requestTimeout=15000;
server.headersTimeout=10000;
server.keepAliveTimeout=5000;
server.maxRequestsPerSocket=1000;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
 if(stopping)return;stopping=true;clearInterval(lifecycleTimer);
 const deadline=setTimeout(()=>process.exit(1),15000);deadline.unref();
 server.close(async()=>{if(pushInFlight)await pushInFlight;database.close();clearTimeout(deadline);process.exit(0)});
 server.closeIdleConnections();
});
// Expired credentials are maintenance data, never user records.
const sessionCleanup=setInterval(()=>run('DELETE FROM sessions WHERE expires<=?',now()),3600000);sessionCleanup.unref();
const PORT=Number(process.env.PORT||8080),HOST=process.env.HOST||'127.0.0.1';
if(process.env.ADMIN_USERNAME||process.env.ADMIN_PASSWORD)console.warn('ADMIN_* bootstrap is retired; use scripts/admin-user.mjs for an existing account');
await migrateLegacyPhotos();
server.listen(PORT,HOST,()=>console.log(`По пути API running at http://${HOST}:${server.address().port}; database at ${DATA}`));

/**
 * По пути — MVP API for Android + PWA (Node 22+, built-in SQLite).
 * Shared server database, authenticated operations, and server-checked roles.
 * Demo / private test deployment, not a production hardening claim.
 * Behind an HTTPS reverse proxy; never expose this directly on the public internet.
 */
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WEB = resolve(ROOT, 'www');
const DATA = resolve(process.env.DATA_DIR || join(ROOT, 'server-data'));
await mkdir(DATA, {recursive:true, mode:0o700});
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
CREATE INDEX IF NOT EXISTS ix_rides_date ON rides(date);
CREATE INDEX IF NOT EXISTS ix_requests_ride ON requests(ride_id);
CREATE INDEX IF NOT EXISTS ix_notes_user ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS ix_messages_ride ON messages(ride_id);
`);
const q = (sql,...args) => database.prepare(sql).get(...args);
const rows = (sql,...args) => database.prepare(sql).all(...args);
const run = (sql,...args) => database.prepare(sql).run(...args);
const uid = () => crypto.randomUUID();
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const now = () => Date.now();
const clean = (value,max=120) => String(value||'').trim().slice(0,max);
const usernameValid = v=>/^[a-z0-9_-]{3,32}$/.test(v);
const passwordValid = v=>typeof v==='string' && v.length>=8 && v.length<=128;
const saltHash = (password,salt) => crypto.scryptSync(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex');
const jsonError=(message,status=400)=>Object.assign(new Error(message),{status});
const allowedOrigins = new Set((process.env.APP_ORIGINS||'https://localhost,capacitor://localhost,http://localhost:8080').split(',').map(v=>v.trim()).filter(Boolean));
const limit = new Map();
function clientIp(req){
 const peer = req.socket.remoteAddress || '';
 const forwarded = String(req.headers['x-real-ip'] || '');
 const localProxy = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer);
 return localProxy && /^[0-9a-fA-F:.]{3,45}$/.test(forwarded) ? forwarded : peer;
}
function checkRate(ip){const t=Date.now(),r=limit.get(ip)||{start:t,count:0};if(t-r.start>15*60_000){r.start=t;r.count=0;}r.count++;limit.set(ip,r);if(r.count>55)throw jsonError('Слишком много попыток. Повторите позже.',429);}
function notify(recipient,title,message,rideId=''){run('INSERT INTO notifications VALUES(?,?,?,?,?,?,?)',uid(),recipient,title,message,rideId,0,now());}
function transaction(fn){database.exec('BEGIN IMMEDIATE');try{const val=fn();database.exec('COMMIT');return val}catch(err){database.exec('ROLLBACK');throw err}}
function getActor(req){const token=(req.headers.authorization||'').match(/^Bearer (\S+)$/)?.[1];if(!token)return null;return q('SELECT u.* FROM users u INNER JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires>?',sha(token),now())||null;}
function requireActor(req){const actor=getActor(req);if(!actor)throw jsonError('Необходим вход в аккаунт',401);return actor;}
function requireAdmin(actor){if(actor.role!=='admin')throw jsonError('Нет прав администратора',403)}
function loggedIn(actor){const token=crypto.randomBytes(32).toString('base64url');run('INSERT INTO sessions VALUES(?,?,?)',sha(token),actor.id,now()+30*24*3600000);return {token,user:{id:actor.id,username:actor.username,role:actor.role}}}
function rideById(id){const ride=q('SELECT * FROM rides WHERE id=?',id);if(!ride)throw jsonError('Поездка не найдена',404);return ride}
function confirmed(rideId,id1,id2){const ride=q('SELECT driver_id FROM rides WHERE id=?',rideId);return Boolean(ride&&((ride.driver_id===id1 && q("SELECT id FROM requests WHERE ride_id=? AND user_id=? AND status='accepted'",rideId,id2))||(ride.driver_id===id2&&q("SELECT id FROM requests WHERE ride_id=? AND user_id=? AND status='accepted'",rideId,id1))));}
function publicRide(r){return {id:r.id,driverId:r.driver_id,from:r.origin,to:r.destination,date:r.date,time:r.time,seats:r.seats,price:r.price,car:r.car,pickup:r.pickup,dropoff:r.dropoff,luggage:r.luggage,comment:r.comment,photo:r.photo,cancelled:!!r.cancelled};}
function isoDay(){return new Date().toISOString().slice(0,10)}
function parseBody(req){return new Promise((resolve,reject)=>{let size=0,parts=[];req.on('data',c=>{size+=c.length;if(size>1_100_000){reject(jsonError('Слишком большой запрос',413));req.destroy();return;}parts.push(c)});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')||'{}'))}catch{reject(jsonError('Некорректные данные'))}});req.on('error',reject)});}
function send(res,data,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))}
function state(actor){const myRideIds=rows('SELECT id FROM rides WHERE driver_id=?',actor.id).map(x=>x.id);const reqs=rows('SELECT * FROM requests WHERE user_id=? OR ride_id IN (SELECT id FROM rides WHERE driver_id=?) ORDER BY created DESC',actor.id,actor.id);
 const peers=new Set([actor.id]);for(const r of reqs){if(r.status==='accepted'){const ride=q('SELECT driver_id FROM rides WHERE id=?',r.ride_id);if(ride){peers.add(ride.driver_id);peers.add(r.user_id)}}}
 const users=rows('SELECT id,username,name,phone,car,photo,role FROM users').map(u=>({...u,phone:peers.has(u.id)?u.phone:''}));
 const rides=rows('SELECT * FROM rides ORDER BY date,time').map(publicRide);
 const notifications=rows('SELECT * FROM notifications WHERE recipient_id=? ORDER BY created DESC LIMIT 300',actor.id).map(n=>({id:n.id,to:n.recipient_id,title:n.title,message:n.message,rideId:n.ride_id,read:!!n.read,created:n.created}));
 const reviews=rows('SELECT r.*,u.name author FROM reviews r JOIN users u ON u.id=r.author_id ORDER BY r.created DESC').map(r=>({id:r.id,rideId:r.ride_id,driverId:r.driver_id,authorId:r.author_id,author:r.author,score:r.score,text:r.text,date:new Date(r.created).toISOString().slice(0,10)}));
 const messages=rows('SELECT * FROM messages WHERE from_id=? OR to_id=? ORDER BY created DESC LIMIT 1000',actor.id,actor.id).map(m=>({id:m.id,rideId:m.ride_id,fromId:m.from_id,toId:m.to_id,text:m.text,created:m.created}));
 return {currentUserId:actor.id,users,rides,requests:reqs.map(r=>({id:r.id,rideId:r.ride_id,userId:r.user_id,status:r.status,created:r.created})),notifications,reviews,messages,reports:[]};
}
function cancelRide(ride,actor,asAdmin=false){if(ride.driver_id!==actor.id&&!asAdmin)throw jsonError('Недостаточно прав',403);if(ride.cancelled)throw jsonError('Поездка уже отменена',409);transaction(()=>{run('UPDATE rides SET cancelled=1 WHERE id=?',ride.id);for(const r of rows("SELECT * FROM requests WHERE ride_id=? AND status IN ('pending','accepted')",ride.id)){run("UPDATE requests SET status='cancelled' WHERE id=?",r.id);notify(r.user_id,'Поездка отменена',`${ride.origin} → ${ride.destination}: поездка отменена`,ride.id)}});return {ok:true};}
function handleApi(req,path,data){const method=req.method;
 if(path==='/api/health' && method==='GET')return {ok:true,backend:'sqlite',version:'0.2'};
 if(path==='/api/register' && method==='POST'){
   checkRate(clientIp(req));const uname=clean(data.username,33).toLowerCase();if(!usernameValid(uname)||!passwordValid(data.password))throw jsonError('Логин должен содержать 3–32 символа, пароль — не менее 8');
   if(q('SELECT id FROM users WHERE username=?',uname))throw jsonError('Этот логин уже занят',409);
   const id=uid(),salt=crypto.randomBytes(20).toString('hex');try{run('INSERT INTO users(id,username,salt,hash,name,role,created) VALUES(?,?,?,?,?,?,?)',id,uname,salt,saltHash(data.password,salt),uname,'user',now())}catch{throw jsonError('Не удалось создать аккаунт',409)}
   return loggedIn(q('SELECT * FROM users WHERE id=?',id));
 }
 if(path==='/api/login' && method==='POST'){
   checkRate(clientIp(req));const uname=clean(data.username,33).toLowerCase();const user=q('SELECT * FROM users WHERE username=?',uname);
   const salt=user?.salt||'no-user-salt',expected=user?.hash||'0'.repeat(128),actual=saltHash(String(data.password||''),salt);
   if(!user||!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(actual,'hex')))throw jsonError('Неверный логин или пароль',401);
   return loggedIn(user);
 }
 const actor=requireActor(req);
 if(path==='/api/state'&&method==='GET')return state(actor);
 if(path==='/api/logout'&&method==='POST'){const token=(req.headers.authorization||'').slice(7);run('DELETE FROM sessions WHERE token_hash=?',sha(token));return {ok:true}}
 if(path==='/api/profile'&&method==='POST'){
   const name=clean(data.name,60),car=clean(data.car,90),phone=clean(data.phone,24);
   if(!name)throw jsonError('Укажите имя');
   if(phone&&!/^[+\\d ()-]{7,24}$/.test(phone))throw jsonError('Неверный формат телефона');
   let photo=actor.photo||'';
   if(Object.hasOwn(data,'photo')){
     if(data.photo==='') photo='';
     else {
       if(typeof data.photo!=='string'||data.photo.length>410000)throw jsonError('Слишком большое фото (максимум 300 КБ)',413);
       const match=data.photo.match(/^data:image\\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
       if(!match)throw jsonError('Допустимы только JPEG, PNG или WebP');
       const bytes=Buffer.from(match[2],'base64');
       if(!bytes.length||bytes.length>300000||bytes.toString('base64')!==match[2])throw jsonError('Некорректное фото или превышен размер 300 КБ',413);
       const jpg=match[1]==='jpeg'&&bytes[0]===0xff&&bytes[1]===0xd8;
       const png=match[1]==='png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
       const webp=match[1]==='webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
       if(!jpg&&!png&&!webp)throw jsonError('Формат изображения не соответствует файлу');
       photo=data.photo;
     }
   }
   run('UPDATE users SET name=?,car=?,phone=?,photo=? WHERE id=?',name,car,phone,photo,actor.id);return {ok:true};
 }
 if(path==='/api/rides'&&method==='POST'){
   const from=clean(data.from,100),to=clean(data.to,100),date=clean(data.date,10),time=clean(data.time,5),car=clean(data.car,90);
   const seats=Number(data.seats),price=data.negotiable?null:Number(data.price);
   if(!from||!to||from.toLowerCase()===to.toLowerCase()||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)||date<isoDay()||!Number.isInteger(seats)||seats<1||seats>7||(!data.negotiable&&(!Number.isInteger(price)||price<0||price>100000))||!car)throw jsonError('Проверьте маршрут, дату, места, стоимость и автомобиль');
   const key=clean(data.clientKey,80);if(key&&!/^[a-zA-Z0-9_-]{10,80}$/.test(key))throw jsonError('Неверный идентификатор операции');
   return transaction(()=>{if(key){const prev=q('SELECT ride_id FROM ride_operations WHERE user_id=? AND client_key=?',actor.id,key);if(prev)return {id:prev.ride_id,repeated:true};}
   const id=uid();run('INSERT INTO rides VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,actor.id,from,to,date,time,seats,price,car,clean(data.pickup,150),clean(data.dropoff,150),clean(data.luggage,60),clean(data.comment,550),'',0,now());if(key)run('INSERT INTO ride_operations VALUES(?,?,?)',actor.id,key,id);return {id};});
 }
 if(path==='/api/requests'&&method==='POST'){
   const ride=rideById(clean(data.rideId,100));if(ride.cancelled||ride.driver_id===actor.id||ride.date<isoDay())throw jsonError('Нельзя отправить заявку на эту поездку',409);
   return transaction(()=>{if(q('SELECT id FROM requests WHERE ride_id=? AND user_id=?',ride.id,actor.id))throw jsonError('Вы уже отправили заявку на поездку',409);
     const occupied=q("SELECT COUNT(*) n FROM requests WHERE ride_id=? AND status='accepted'",ride.id).n;if(occupied>=ride.seats)throw jsonError('Свободных мест больше нет',409);
     const id=uid();run('INSERT INTO requests VALUES(?,?,?,?,?)',id,ride.id,actor.id,'pending',now());notify(ride.driver_id,'Новая заявка',`${actor.name} хочет поехать: ${ride.origin} → ${ride.destination}`,ride.id);return {id};});
 }
 let m=path.match(/^\/api\/requests\/([^/]+)\/(accept|reject)$/);
 if(m&&method==='POST'){
   const reqst=q('SELECT * FROM requests WHERE id=?',m[1]);if(!reqst)throw jsonError('Заявка не найдена',404);
   const ride=rideById(reqst.ride_id);if(ride.driver_id!==actor.id)throw jsonError('Вы не владелец поездки',403);
   return transaction(()=>{const fresh=q('SELECT * FROM requests WHERE id=?',m[1]);if(fresh.status!=='pending'||ride.cancelled)throw jsonError('Заявка уже обработана или поездка отменена',409);
     if(m[2]==='accept'&&q("SELECT COUNT(*) n FROM requests WHERE ride_id=? AND status='accepted'",ride.id).n>=ride.seats)throw jsonError('Свободных мест больше нет',409);
     const status=m[2]==='accept'?'accepted':'rejected';run('UPDATE requests SET status=? WHERE id=?',status,m[1]);notify(fresh.user_id,status==='accepted'?'Заявка подтверждена':'Заявка отклонена',`${ride.origin} → ${ride.destination}: ${status==='accepted'?'водитель принял вашу заявку':'водитель отклонил вашу заявку'}`,ride.id);return {ok:true,status};});
 }
 m=path.match(/^\/api\/rides\/([^/]+)\/cancel$/);if(m&&method==='POST')return cancelRide(rideById(m[1]),actor);
 m=path.match(/^\/api\/admin\/rides\/([^/]+)\/cancel$/);if(m&&method==='POST'){requireAdmin(actor);return cancelRide(rideById(m[1]),actor,true)}
 m=path.match(/^\/api\/notifications\/([^/]+)\/read$/);if(m&&method==='POST'){run('UPDATE notifications SET read=1 WHERE id=? AND recipient_id=?',m[1],actor.id);return {ok:true}}
 if(path==='/api/messages'&&method==='POST'){
   const rideId=clean(data.rideId,100),toId=clean(data.toId,100),txt=clean(data.text,1200);if(!txt||!confirmed(rideId,actor.id,toId))throw jsonError('Чат доступен только участникам подтверждённой поездки',403);
   const id=uid();run('INSERT INTO messages VALUES(?,?,?,?,?,?)',id,rideId,actor.id,toId,txt,now());notify(toId,'Новое сообщение',txt.slice(0,120),rideId);return {id};
 }
 if(path==='/api/reviews'&&method==='POST'){
   const ride=rideById(clean(data.rideId,100)),score=Number(data.score),txt=clean(data.text,500);if(!Number.isInteger(score)||score<1||score>5||!txt||new Date(ride.date+'T'+ride.time+':00').getTime()>Date.now()||!q("SELECT id FROM requests WHERE ride_id=? AND user_id=? AND status='accepted'",ride.id,actor.id))throw jsonError('Отзыв возможен только после подтверждённой завершённой поездки',403);
   try{run('INSERT INTO reviews VALUES(?,?,?,?,?,?,?)',uid(),ride.id,ride.driver_id,actor.id,score,txt,now())}catch{throw jsonError('Отзыв на эту поездку уже оставлен',409)}return {ok:true};
 }
 if(path==='/api/reports'&&method==='POST'){
   const ride=rideById(clean(data.rideId,100)),reason=clean(data.reason,100),details=clean(data.details,500);if(!reason)throw jsonError('Выберите причину жалобы');run('INSERT INTO reports VALUES(?,?,?,?,?,?)',uid(),ride.id,actor.id,reason,details,now());return {ok:true};
 }
 if(path==='/api/admin/overview'&&method==='GET'){
   requireAdmin(actor);return {users:rows('SELECT id,username,name,role FROM users ORDER BY created DESC'),rides:rows('SELECT * FROM rides ORDER BY created DESC LIMIT 100').map(publicRide),requests:rows('SELECT id,ride_id,user_id,status FROM requests ORDER BY created DESC LIMIT 100'),reports:rows('SELECT id,ride_id rideId,reason,details,created FROM reports ORDER BY created DESC LIMIT 100')};
 }
 throw jsonError('Маршрут API не найден',404);
}
async function serveStatic(res,pathname){let path=pathname==='/'?'/index.html':pathname;
 try{path=decodeURIComponent(path)}catch{throw jsonError('Неверный путь',400)}
 const file=resolve(WEB,'.'+path);if(!file.startsWith(WEB+sep))throw jsonError('Доступ запрещён',403);
 if(!existsSync(file))throw jsonError('Файл не найден',404);
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
 res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','x-content-type-options':'nosniff','cache-control':'no-cache'});res.end(await readFile(file));
}
const server=http.createServer(async(req,res)=>{
 const reqUrl=new URL(req.url,'http://localhost');const origin=req.headers.origin;
 if(origin&&allowedOrigins.has(origin)){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');res.setHeader('access-control-allow-headers','Content-Type, Authorization');res.setHeader('access-control-allow-methods','GET, POST, OPTIONS')}
 res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','strict-origin-when-cross-origin');
 try{
  if(req.method==='OPTIONS'){res.writeHead(origin&&!allowedOrigins.has(origin)?403:204);res.end();return;}
  if(origin&&!allowedOrigins.has(origin)&&reqUrl.pathname.startsWith('/api/'))throw jsonError('Origin не разрешён',403);
  if(reqUrl.pathname==='/config.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});res.end('window.PO_PUTI_BACKEND = true;');return;}
  if(reqUrl.pathname.startsWith('/api/')){const data=req.method==='POST'?await parseBody(req):{};const output=handleApi(req,reqUrl.pathname,data);send(res,output);return;}
  if(req.method==='GET'||req.method==='HEAD')return await serveStatic(res,reqUrl.pathname);
  throw jsonError('Метод не поддерживается',405);
 }catch(error){if(!res.headersSent){send(res,{error:error.status?error.message:'Внутренняя ошибка сервера'},error.status||500)}else res.end();if(!error.status)console.error(error)}
});
const PORT=Number(process.env.PORT||8080),HOST=process.env.HOST||'127.0.0.1';
if(process.env.ADMIN_USERNAME&&process.env.ADMIN_PASSWORD){
 const uname=process.env.ADMIN_USERNAME.toLowerCase();if(!usernameValid(uname)||!passwordValid(process.env.ADMIN_PASSWORD))throw Error('Invalid ADMIN_USERNAME or ADMIN_PASSWORD (minimum 8 chars)');
 let admin=q('SELECT * FROM users WHERE username=?',uname);
 if(!admin){const salt=crypto.randomBytes(20).toString('hex');run('INSERT INTO users(id,username,salt,hash,name,role,created) VALUES(?,?,?,?,?,?,?)',uid(),uname,salt,saltHash(process.env.ADMIN_PASSWORD,salt),'Администратор','admin',now());console.log('Administrator account created:',uname)}
 else if(admin.role!=='admin')console.error('Admin username already exists without admin role; not escalating');
}
server.listen(PORT,HOST,()=>console.log(`По пути API running at http://${HOST}:${PORT}; database at ${DATA}`));

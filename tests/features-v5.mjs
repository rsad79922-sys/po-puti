import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {isolatedServer} from './helpers/server.mjs';
import {seriesDates} from '../server/ride-series.mjs';
import {timetables} from '../server/timetables.mjs';
import {adminMfa,totp} from '../server/admin-mfa.mjs';
import {migrateFeatures} from '../server/migrations-v5.mjs';

const router=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({code:'Ok',routes:[{distance:180000,duration:5400}]}))});router.listen(0,'127.0.0.1');await once(router,'listening');
const app=await isolatedServer({ROUTING_PROVIDER:'osrm',ROUTING_URL:'http://127.0.0.1:'+router.address().port});let db;
async function api(path,method='GET',body,who){const r=await fetch(app.base+'/api'+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(who?{Authorization:'Bearer '+who.token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
async function ok(...args){const r=await api(...args);assert.equal(r.status,200,JSON.stringify(r));return r.data}
const register=name=>ok('/register','POST',{username:name,password:'private-'+randomUUID()});
try{
 const driver=await register('series_driver'),passenger=await register('series_passenger'),stranger=await register('series_stranger');
 db=new DatabaseSync(app.dir+'/po-puti.sqlite');db.exec('PRAGMA foreign_keys=ON');
 const backups=(await readdir(app.dir+'/migration-backups')).length;await migrateFeatures(db,app.dir);assert.equal((await readdir(app.dir+'/migration-backups')).length,backups,'idempotent migration creates no new backup');
 const start=new Date(Date.now()+3*86400000).toISOString().slice(0,10),end=new Date(Date.parse(start)+6*86400000).toISOString().slice(0,10);
 assert.equal(seriesDates({date:start,seriesEnd:end,weekdays:[0,1,2,3,4,5,6]}).length,7);
 assert.throws(()=>seriesDates({date:start,seriesEnd:new Date(Date.parse(start)+7*86400000).toISOString().slice(0,10),weekdays:[1]}),/7 календарных/);
 const quote=await ok('/routes/estimate','POST',{from:'Москва',to:'Тверь',date:start,time:'12:00',routePoints:[{address:'Москва',lon:37.6173,lat:55.7558},{address:'Тверь',lon:35.91,lat:56.86}]},driver);
 const body={from:'Москва',to:'Тверь',date:start,time:'12:00',seats:1,price:300,car:'Lada',routePoints:quote.points,routeQuoteId:quote.routeQuoteId,clientKey:'series_'+randomUUID(),seriesEnd:end,weekdays:[0,1,2,3,4,5,6],privateRide:true};
 const created=await ok('/series','POST',body,driver);assert.equal(created.rides.length,7);
 const repeated=await Promise.all([ok('/series','POST',body,driver),ok('/series','POST',body,driver)]);assert(repeated.every(r=>r.repeated&&r.seriesId===created.seriesId));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM rides WHERE series_id=?').get(created.seriesId).n,7);
 assert.equal((await api('/series','POST',{...body,clientKey:'bad_'+randomUUID(),privateRide:false},driver)).status,400);
 const [first,second]=created.rides;
 const booking=await ok('/requests','POST',{rideId:first.id},passenger),other=await ok('/requests','POST',{rideId:first.id},stranger);
 const accepted=await Promise.all([api('/requests/'+booking.id+'/accept','POST',{},driver),api('/requests/'+other.id+'/accept','POST',{},driver)]);assert.equal(accepted.filter(r=>r.status===200).length,1,'last seat cannot be accepted twice');
 await ok('/rides/'+second.id+'/cancel','POST',{},driver);assert.equal(db.prepare('SELECT COUNT(*) n FROM rides WHERE series_id=? AND cancelled=0').get(created.seriesId).n,6);
 assert.equal((await api('/rides/'+first.id+'/cancel','POST',{},stranger)).status,403);
 const found=await ok('/search?'+new URLSearchParams({from:'Москва',to:'Тверь',date:created.rides[2].date,type:'private'}),'GET',undefined,passenger);assert.equal(found.private.items.length,1);assert.equal(found.private.items[0].seriesId,created.seriesId);
 assert.equal((await ok('/search?from=Москва&to=Тверь&date='+start+'&type=bus','GET',undefined,driver)).bus.status,'not_configured');
 const config=await ok('/client-config','GET',undefined,driver);assert.equal(config.ads.enabled,false);assert(config.ads.web.length===2&&config.ads.android.length===2);
 const deletion=await ok('/account/deletion-request','POST',{confirmation:'DELETE_MY_ACCOUNT'},passenger);assert.equal(deletion.status,'pending');assert.equal(db.prepare('SELECT name FROM users WHERE id=?').get(passenger.user.id).name,'series_passenger','request does not delete user data');
 const now=Date.parse('2030-05-10T00:00:00Z');let calls=0,mode='ok';
 const env={YANDEX_RASP_API_KEY:'test-key-never-returned',RASP_LICENSE_CONFIRMED:'true',RASP_DAILY_LIMIT:'20',RASP_CACHE_SECONDS:'60'};
 const provider=timetables(db,{env,clock:()=>now,fetcher:async(url,options)=>{calls++;assert.equal(options.headers.Authorization,env.YANDEX_RASP_API_KEY);assert(!String(url).includes(env.YANDEX_RASP_API_KEY));if(String(url).includes('/copyright/'))return new Response(JSON.stringify({copyright:{logo_vm:'<iframe src="//yandex.st/rasp/media/apicc/copyright_vert_mono.html"></iframe>'}}));if(mode==='429')return new Response('{}',{status:429});if(mode==='broken')throw Error('private provider URL with secret');await new Promise(r=>setTimeout(r,5));return new Response(JSON.stringify({pagination:{total:1},segments:[{departure:'2030-05-10T04:00:00Z',arrival:'2030-05-10T06:00:00Z',has_transfers:false,from:{code:'s100',title:'Нефтекамск, автостанция'},to:{code:'s200',title:'Уфа, автовокзал'},thread:{uid:'bus-1',transport_type:'bus',carrier:{title:'Проверенный перевозчик',phone:'+7-private',url:'https://carrier.example'}}}]}))}});
 const catalog={countries:[{regions:[{title:'Башкортостан',settlements:[{title:'Нефтекамск',codes:{yandex_code:'c100'},stations:[{title:'Нефтекамск, автостанция',codes:{yandex_code:'s100'},transport_type:'bus',longitude:54.25,latitude:56.09}]},{title:'Уфа',codes:{yandex_code:'c200'},stations:[{title:'Уфа, автовокзал',codes:{yandex_code:'s200'},transport_type:'bus',longitude:55.96,latitude:54.74}]}]}]}]};
 provider.importCatalog(catalog);assert((await provider.places('нефтекамск')).items.length>=1,'Cyrillic search must ignore case');
 const searches=await Promise.all([provider.search({from:'c100',to:'c200',date:'2030-05-10'}),provider.search({from:'Нефтекамск',to:'Уфа',date:'2030-05-10'})]);assert.equal(calls,2,'concurrent identical upstream requests coalesce');
 assert.equal(searches[0].items[0].departureTimeZone,'Asia/Yekaterinburg');assert.equal(searches[0].items[0].purchase.url,'');assert(!JSON.stringify(searches).includes('+7-private'));assert(!JSON.stringify(searches).includes('carrier.example'));for(const forbidden of ['seats','price','phone','reviews','chat','booking'])assert(!(forbidden in searches[0].items[0]));
 await provider.search({from:'c100',to:'c200',date:'2030-05-10'});assert.equal(calls,2,'temporary cache works');
 mode='429';assert.equal((await provider.search({from:'c100',to:'c200',date:'2030-05-11'})).status,'quota_exceeded');const previous=calls;await provider.search({from:'c100',to:'c200',date:'2030-05-12'});assert.equal(calls,previous,'429 cooldown prevents repeated upstream requests');
 assert.equal((await provider.search({from:'unknown',to:'c200',date:'2030-05-10'})).status,'choose_places');
 assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',1),'287082','RFC 6238 vector');
 const auth=adminMfa(db,{env:{ADMIN_MFA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')},clock:()=>now});const enrollment=auth.enroll({...driver.user,username:'series_driver'}),pin=totp(enrollment.secret,Math.floor(now/30000));assert(!auth.get(driver.user.id).secret_enc.includes(enrollment.secret));assert(auth.verify(driver.user.id,pin,true));assert.throws(()=>auth.verify(driver.user.id,pin),/Неверный/,'TOTP replay rejected');
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 console.log('PASS: seven-day series, atomic idempotency and capacity, independent dates, safe migration, shared search, Cyrillic station catalog, real bus DTO privacy, quota/cooldown/cache, no secret URLs and MFA replay protection');
}finally{db?.close();await app.stop();router.close();await once(router,'close')}

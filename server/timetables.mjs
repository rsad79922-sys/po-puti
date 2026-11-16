import {createHash} from 'node:crypto';
import {fail} from './lifecycle.mjs';
import {zoneAt,validZone} from './timezones.mjs';

const text=(v,n=200)=>typeof v==='string'?v.trim().slice(0,n):'';
const code=v=>/^[cs]\d{1,12}$/.test(String(v||''));
const day=86400000;
export function raspInstant(value){
 if(typeof value!=='string')return NaN;
 const iso=value.replace(' ','T');
 if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/i.test(iso))return NaN;
 const date=iso.slice(0,10),midnight=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(midnight)||new Date(midnight).toISOString().slice(0,10)!==date)return NaN;
 // search requests explicitly specify result_timezone=UTC, including offset-less legacy responses.
 return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/i.test(iso)?iso:iso+'Z');
}
export function safeTicketUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.port===''&&u.hostname.includes('.')&&!/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)?u.href:''}catch{return ''}}
export function prepareTimetableCache(db){db.exec(`PRAGMA secure_delete=ON;
 CREATE TABLE IF NOT EXISTS external_cache(cache_key TEXT PRIMARY KEY,value_json TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS bus_places(code TEXT PRIMARY KEY,title TEXT NOT NULL,region TEXT NOT NULL DEFAULT '',time_zone TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('settlement','station')),verified_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,search_title TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS ix_bus_place_search ON bus_places(search_title,expires_at);
`);return db}
export function timetables(db,{env=process.env,clock=Date.now,fetcher=fetch,cacheDb}={}){
 if(!cacheDb||cacheDb===db)throw Error('Timetables require a separate ephemeral cache, never the user database');
 const target=s=>/\b(?:external_cache|bus_places)\b/.test(s)?cacheDb:db;
 const get=(s,...a)=>target(s).prepare(s).get(...a),all=(s,...a)=>target(s).prepare(s).all(...a),run=(s,...a)=>target(s).prepare(s).run(...a);
 const configured=()=>!!env.YANDEX_RASP_API_KEY&&env.RASP_LICENSE_CONFIRMED==='true'&&Number.isInteger(Number(env.RASP_DAILY_LIMIT))&&Number(env.RASP_DAILY_LIMIT)>0&&Number(env.RASP_DAILY_LIMIT)<=100000&&Number.isInteger(Number(env.RASP_CACHE_SECONDS))&&Number(env.RASP_CACHE_SECONDS)>0&&Number(env.RASP_CACHE_SECONDS)<=86400;
 const flights=new Map();let catalogPromise=null,copyrightPromise=null,cooldown=0,active=0;
 const ttl=()=>Math.min(Number(env.RASP_CACHE_SECONDS)*1000,day);
 const status=()=>({configured:configured(),source:'yandex_rasp',dailyLimit:Number(env.RASP_DAILY_LIMIT)||null,cacheSeconds:Number(env.RASP_CACHE_SECONDS)||null});
 async function request(resource,params={},maxBytes=4*1024*1024){
  if(!configured())throw Object.assign(Error('not_configured'),{code:'not_configured'});
  if(clock()<cooldown)throw Object.assign(Error('quota_exceeded'),{code:'quota_exceeded'});
  if(active>=3)throw Object.assign(Error('busy'),{code:'unavailable'});
  // A rolling window cannot reset early and exceed the account's daily allowance.
  db.exec('BEGIN IMMEDIATE');try{if(get("SELECT COUNT(*) n FROM external_usage WHERE provider='rasp' AND requested_at>?",clock()-day).n>=Number(env.RASP_DAILY_LIMIT))throw Object.assign(Error('quota_exceeded'),{code:'quota_exceeded'});run("INSERT INTO external_usage VALUES('rasp',?)",clock());db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  const url=new URL('https://api.rasp.yandex-net.ru/v3.0/'+resource+'/');for(const [k,v] of Object.entries({...params,format:'json',lang:'ru_RU'}))url.searchParams.set(k,String(v));
  run("INSERT INTO external_provider_state(provider,last_attempt_at) VALUES('rasp',?) ON CONFLICT(provider) DO UPDATE SET last_attempt_at=excluded.last_attempt_at",clock());
  let statusCode=null;active++;try{
   const response=await fetcher(url,{headers:{Authorization:env.YANDEX_RASP_API_KEY},redirect:'error',signal:AbortSignal.timeout(resource==='stations_list'?20000:6500)});
   statusCode=response.status;
   if(response.status===429){cooldown=clock()+Math.max(60000,Math.min(Number(response.headers.get('retry-after'))*1000||60000,day));throw Object.assign(Error('quota_exceeded'),{code:'quota_exceeded'})}
   if(!response.ok)throw Error('upstream');
   if(Number(response.headers.get('content-length'))>maxBytes)throw Error('response_size');
   let bytes=0,parts=[],body;if(response.body){for await(const part of response.body){bytes+=part.length;if(bytes>maxBytes)throw Error('response_size');parts.push(part)}body=JSON.parse(Buffer.concat(parts).toString('utf8'))}else body=await response.json();
   run("UPDATE external_provider_state SET last_success_at=?,last_status=?,last_error='' WHERE provider='rasp'",clock(),statusCode);return body;
  }catch(error){const code=error.code==='quota_exceeded'?'quota_exceeded':'provider_unavailable';run("UPDATE external_provider_state SET last_status=?,last_error=? WHERE provider='rasp'",statusCode,code);console.warn('[timetables]',code,statusCode||'network');throw error}
  finally{active--}
 }
 function importCatalog(data){
  if(!Array.isArray(data?.countries))throw fail('Неверный справочник станций');let count=0;
  cacheDb.exec('BEGIN IMMEDIATE');try{
   for(const country of data.countries)for(const region of country.regions||[])for(const city of region.settlements||[]){
    const stations=(city.stations||[]).filter(s=>s.transport_type==='bus'&&code(s.codes?.yandex_code));if(!stations.length)continue;
    for(const item of [{...city,kind:'settlement',longitude:stations[0].longitude,latitude:stations[0].latitude},...stations.map(s=>({...s,kind:'station'}))]){
     if(!code(item.codes?.yandex_code)||!item.title||!Number.isFinite(Number(item.longitude))||!Number.isFinite(Number(item.latitude)))continue;
     let zone;try{zone=zoneAt(Number(item.longitude),Number(item.latitude))}catch{continue}
     run('INSERT INTO bus_places VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET title=excluded.title,region=excluded.region,time_zone=excluded.time_zone,verified_at=excluded.verified_at,expires_at=excluded.expires_at,search_title=excluded.search_title',item.codes.yandex_code,text(item.title),text(region.title),zone,item.kind,clock(),clock()+ttl(),text(item.title).toLocaleLowerCase('ru'));count++;
    }
   }
   cacheDb.exec('COMMIT');return {count};
  }catch(e){cacheDb.exec('ROLLBACK');throw e}
 }
 async function places(query){
  const q=text(query,100);if(q.length<2)return {items:[]};
  if(!configured())return {items:[],status:'not_configured'};
  try{if(!get('SELECT code FROM bus_places WHERE expires_at>? LIMIT 1',clock())){
   if(!catalogPromise)catalogPromise=request('stations_list',{},96*1024*1024).then(importCatalog).finally(()=>catalogPromise=null);
   await catalogPromise;
  }}catch(e){return {items:[],status:e.code==='quota_exceeded'?'quota_exceeded':'unavailable'}}
  const items=all("SELECT code,title,region,time_zone timeZone,kind FROM bus_places WHERE expires_at>? AND search_title LIKE ? ESCAPE '\\' ORDER BY CASE WHEN search_title=? THEN 0 ELSE 1 END,kind,title LIMIT 20",clock(),'%'+q.toLocaleLowerCase('ru').replace(/[\\%_]/g,'\\$&')+'%',q.toLocaleLowerCase('ru'));
  return {items,status:items.length?'ok':'empty'};
 }
 function resolve(value){
  if(code(value))return get('SELECT * FROM bus_places WHERE code=? AND expires_at>?',value,clock());
  const items=all('SELECT * FROM bus_places WHERE search_title=? AND expires_at>? AND kind=\'settlement\' LIMIT 2',text(value).toLocaleLowerCase('ru'),clock());return items.length===1?items[0]:null;
 }
 async function copyright(){
  const old=get("SELECT value_json FROM external_cache WHERE cache_key='rasp:copyright' AND expires_at>?",clock());if(old)return JSON.parse(old.value_json);
  if(!copyrightPromise)copyrightPromise=(async()=>{const raw=await request('copyright'),html=raw.copyright?.logo_vm;
   const src=typeof html==='string'?html.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]:null;
   if(!src)throw Error('copyright_missing');const url=new URL(src.startsWith('//')?'https:'+src:src);
   if(url.protocol!=='https:'||url.username||url.password||!['yandex.st','yastatic.net','yandex.ru','rasp.yandex.ru'].includes(url.hostname)||!url.pathname.startsWith('/rasp/'))throw Error('copyright_invalid');
   const value={frameUrl:url.href,text:'Данные предоставлены сервисом Яндекс.Расписания',url:'https://rasp.yandex.ru/'};run("INSERT INTO external_cache VALUES('rasp:copyright',?,?) ON CONFLICT(cache_key) DO UPDATE SET value_json=excluded.value_json,expires_at=excluded.expires_at",JSON.stringify(value),clock()+ttl());return value;
  })().finally(()=>copyrightPromise=null);return copyrightPromise;
 }
 async function search(params){
  const from=text(params.from),to=text(params.to),date=text(params.date,10),offset=Number(params.offset||0);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw fail('Выберите дату поиска');
  if(!Number.isInteger(offset)||offset<0||offset>1000)throw fail('Неверная страница');
  if(!configured())return {items:[],status:'not_configured'};
  const a=resolve(from),b=resolve(to);if(!a||!b)return {items:[],status:'choose_places',message:'Выберите населённые пункты или станции из списка'};
  const cacheKey=createHash('sha256').update(JSON.stringify(['bus',a.code,b.code,date,offset])).digest('hex');
  const cached=get('SELECT value_json FROM external_cache WHERE cache_key=? AND expires_at>?',cacheKey,clock());if(cached)return {...JSON.parse(cached.value_json),cached:true};
  if(flights.has(cacheKey))return flights.get(cacheKey);
  const pending=(async()=>{try{
   const [raw,credit]=await Promise.all([request('search',{from:a.code,to:b.code,date,transport_types:'bus',transfers:false,result_timezone:'UTC',limit:50,offset}),copyright()]);
   if(!Array.isArray(raw.segments))throw Error('invalid_schema');
   const items=[];
   for(const s of raw.segments){
    if(s.has_transfers||s.thread?.transport_type!=='bus'||!code(s.from?.code)||!code(s.to?.code))continue;
    const dep=raspInstant(s.departure),arr=raspInstant(s.arrival);if(!Number.isFinite(dep)||!Number.isFinite(arr)||arr<dep)continue;
    const origin=resolve(s.from.code),destination=resolve(s.to.code),originZone=origin?.time_zone||a.time_zone;
    const local=new Intl.DateTimeFormat('en-CA',{timeZone:originZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(dep);if(local!==date)continue;
    let destZone=destination?.time_zone||b.time_zone;try{validZone(destZone)}catch{destZone=originZone}
    const purchase=get('SELECT * FROM bus_purchase_info WHERE thread_uid=? AND service_date=? AND from_code=? AND to_code=? AND valid_until>?',text(s.thread.uid),date,s.from.code,s.to.code,clock());
    items.push({type:'bus_service',id:createHash('sha256').update(JSON.stringify([s.thread.uid,s.from.code,s.to.code,dep])).digest('hex'),departureAt:new Date(dep).toISOString(),arrivalAt:new Date(arr).toISOString(),departureTimeZone:originZone,destinationTimeZone:destZone,from:text(s.from.title),to:text(s.to.title),carrier:text(s.thread.carrier?.title),purchase:purchase?{url:safeTicketUrl(purchase.url),cashier:text(purchase.cashier,500)}:{url:'',cashier:''},source:'yandex_rasp'});
   }
   const total=Number(raw.pagination?.total)||items.length;const out={items,status:items.length?'ok':'empty',nextOffset:offset+50<total?offset+50:null,expiresAt:clock()+ttl(),copyright:credit,attribution:credit.text,attributionUrl:credit.url};
   run('INSERT INTO external_cache VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET value_json=excluded.value_json,expires_at=excluded.expires_at',cacheKey,JSON.stringify(out),clock()+ttl());return out;
  }catch(e){return {items:[],status:e.code==='quota_exceeded'?'quota_exceeded':'unavailable'}}})();
  flights.set(cacheKey,pending);try{return await pending}finally{flights.delete(cacheKey)}
 }
 const purgeExpired=()=>{run('DELETE FROM external_cache WHERE expires_at<=?',clock());run('DELETE FROM bus_places WHERE expires_at<=?',clock())};
 const invalidatePurchases=()=>run("DELETE FROM external_cache WHERE cache_key<>'rasp:copyright'");
 return {places,search,status,importCatalog,resolve,purgeExpired,invalidatePurchases};
}

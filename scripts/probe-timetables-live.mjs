// Public-city smoke probe on an isolated in-memory DB. Never connects to live user data.
import {DatabaseSync} from 'node:sqlite';
import {prepareTimetableCache,timetables} from '../server/timetables.mjs';
const db=new DatabaseSync(':memory:'),cache=prepareTimetableCache(new DatabaseSync(':memory:'));
db.exec(`CREATE TABLE external_usage(provider TEXT,requested_at INTEGER);
 CREATE TABLE external_provider_state(provider TEXT PRIMARY KEY,last_attempt_at INTEGER,last_success_at INTEGER,last_status INTEGER,last_error TEXT DEFAULT '');
 CREATE TABLE bus_purchase_info(thread_uid TEXT,service_date TEXT,from_code TEXT,to_code TEXT,valid_until INTEGER,url TEXT,cashier TEXT);`);
try{
 const buses=timetables(db,{cacheDb:cache,env:{...process.env,RASP_LICENSE_CONFIRMED:'true',RASP_DAILY_LIMIT:'450',RASP_CACHE_SECONDS:'1800'}});
 if(!buses.status().configured)throw Error('not_configured');
 const from=await buses.places('Уфа'),to=await buses.places('Нефтекамск');
 const a=from.items.find(p=>p.kind==='settlement'&&p.title==='Уфа'),b=to.items.find(p=>p.kind==='settlement'&&p.title==='Нефтекамск');
 if(!a||!b)throw Error('public_city_catalog_unavailable');
 const result=await buses.search({from:a.code,to:b.code,date:new Date(Date.now()+86400000).toISOString().slice(0,10)});
 if(!['ok','empty'].includes(result.status))throw Error('search_unavailable');
 console.log('RASP_LIVE_PROBE_OK',JSON.stringify({catalog:true,searchStatus:result.status,resultCount:result.items.length,attribution:!!result.copyright,privateDataUsed:false}));
}catch{console.error('RASP_LIVE_PROBE_FAILED: public catalog/search/attribution unavailable; no settings changed');process.exitCode=1}
finally{cache.close();db.close()}

/**
 * End-to-end server API checks with disposable SQLite (NOT production).
 * Covers two synchronized clients plus an unrelated third account.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const temp=await mkdtemp(join(tmpdir(),'po-puti-flow-'));
const port=20000+Math.floor(Math.random()*30000);
const base='http://127.0.0.1:'+port+'/api';
const processServer=spawn(process.execPath,[new URL('../server/server.mjs',import.meta.url).pathname],{
  env:{...process.env,DATA_DIR:temp,PORT:String(port),HOST:'127.0.0.1',ADMIN_USERNAME:'',ADMIN_PASSWORD:''},
  stdio:['ignore','pipe','pipe']
});
let serverOutput='';
processServer.stderr.on('data',part=>serverOutput+=String(part));

async function request(path,method='GET',body,token){
 const res=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const json=await res.json();
 return {status:res.status,data:json};
}
async function ok(path,method,body,token){
 const result=await request(path,method,body,token);
 assert.equal(result.status,200,path+': '+JSON.stringify(result.data));
 return result.data;
}
try{
 let live=false;
 for(let i=0;i<80;i++){
   if(processServer.exitCode!==null)throw Error('Server process exited: '+serverOutput);
   try{const r=await request('/health');if(r.status===200){live=true;break}}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(live,'Server failed: '+serverOutput);
 const suffix=crypto.randomBytes(6).toString('hex');
 const driver=await ok('/register','POST',{username:'drv_'+suffix,password:'correct-horse-battery-staple'});
 const passenger=await ok('/register','POST',{username:'psg_'+suffix,password:'correct-horse-battery-staple'});
 const outsider=await ok('/register','POST',{username:'out_'+suffix,password:'correct-horse-battery-staple'});
 await ok('/profile','POST',{name:'Водитель',phone:'+79991110000',car:'Toyota'},driver.token);
 await ok('/profile','POST',{name:'Пассажир',phone:'+79992220000'},passenger.token);
 // Seed one legitimate completed trip/review outside the first driver's scope.
 // /state must include it for the participant but NOT leak it to unrelated users.
 const outsiderRideId=crypto.randomUUID(),outsiderReviewId=crypto.randomUUID();
 const historical=new Date(Date.now()-4*86400000).toISOString().slice(0,10);
 const historicalAt=Date.now()-4*86400000;
 const fixture=new DatabaseSync(join(temp,'po-puti.sqlite'));
 try {
  fixture.prepare('INSERT INTO rides(id,driver_id,origin,destination,date,time,seats,price,car,created) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run(outsiderRideId,outsider.user.id,'Уфа','Ижевск',historical,'10:00',2,1000,'Ford',historicalAt);
  fixture.prepare('INSERT INTO requests VALUES(?,?,?,?,?)')
   .run(crypto.randomUUID(),outsiderRideId,passenger.user.id,'accepted',historicalAt);
  fixture.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?)')
   .run(outsiderReviewId,outsiderRideId,outsider.user.id,passenger.user.id,5,'Отличная поездка',Date.now()-86400000);
 } finally {fixture.close();}
 const dState=await ok('/state','GET',undefined,driver.token);
 const pState=await ok('/state','GET',undefined,passenger.token);
 assert(!dState.reviews.some(r=>r.id===outsiderReviewId),'unrelated historical driver review leaked');
 assert(pState.reviews.some(r=>r.id===outsiderReviewId),'passenger lost review of their past driver');
 assert(!dState.users.some(u=>u.id===outsider.user.id),'unrelated user leaked to driver');
 assert(!pState.users.some(u=>u.id===outsider.user.id),'unrelated user leaked to passenger');
 const travelDate=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
 const rideBody={from:'Казань',to:'Самара',date:travelDate,time:'15:30',seats:2,price:900,car:'Toyota',clientKey:'ride_'+suffix};
 // API must not accept impossible dates or times even if Android/UI validation is bypassed.
 const impossibleDate=await request('/rides','POST',{...rideBody,date:'2099-02-30'},driver.token);
 assert.equal(impossibleDate.status,400,'invalid calendar date was accepted');
 const impossibleTime=await request('/rides','POST',{...rideBody,time:'29:77'},driver.token);
 assert.equal(impossibleTime.status,400,'invalid departure time was accepted');
 const ride=await ok('/rides','POST',rideBody,driver.token);
 const duplicate=await ok('/rides','POST',rideBody,driver.token);
 assert.equal(ride.id,duplicate.id,'ride idempotency failed');
 let passengerView=await ok('/state','GET',undefined,passenger.token);
 assert(passengerView.rides.some(r=>r.id===ride.id),'shared database lost published trip');
 const driverInPassengerView=passengerView.users.find(u=>u.id===driver.user.id);
 assert(driverInPassengerView,'public driver missing from ride list');
 assert.equal(driverInPassengerView.phone,'','driver phone exposed before booking confirmation');
 const requestResult=await ok('/requests','POST',{rideId:ride.id},passenger.token);
 const driverView=await ok('/state','GET',undefined,driver.token);
 assert(driverView.requests.some(r=>r.id===requestResult.id),'driver did not receive booking');
 assert(driverView.users.some(u=>u.id===passenger.user.id),'driver cannot see requesting passenger');
 const unauthorized=await request('/requests/'+requestResult.id+'/accept','POST',{},outsider.token);
 assert.equal(unauthorized.status,403,'unrelated user accepted booking');
 await ok('/requests/'+requestResult.id+'/accept','POST',{},driver.token);
 passengerView=await ok('/state','GET',undefined,passenger.token);
 assert.equal(passengerView.users.find(u=>u.id===driver.user.id).phone,'+79991110000','confirmed passenger cannot see driver phone');
 await ok('/messages','POST',{rideId:ride.id,toId:driver.user.id,text:'Здравствуйте'},passenger.token);
 const newDriverView=await ok('/state','GET',undefined,driver.token);
 assert(newDriverView.messages.some(m=>m.text==='Здравствуйте'),'driver did not receive message');
 assert.equal((await request('/admin/overview','GET',undefined,passenger.token)).status,403,'passenger reached admin API');
 await ok('/rides/'+ride.id+'/cancel','POST',{},driver.token);
 assert.equal((await request('/messages','POST',{rideId:ride.id,toId:driver.user.id,text:'После отмены'},passenger.token)).status,403,'cancelled trip still permits messaging');
 console.log('PASS: real SQLite API cross-device booking, roles, profile privacy, chat, idempotency and cancellation');
}finally{
 processServer.kill('SIGTERM');
 await new Promise(resolve=>{
  if(processServer.exitCode!==null||processServer.signalCode!==null)return resolve();
  processServer.once('exit',resolve);setTimeout(resolve,4000);
 });
 await rm(temp,{recursive:true,force:true});
}

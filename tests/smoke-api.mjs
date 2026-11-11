/** Run with `node tests/smoke-api.mjs` while server is running. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const BASE=(process.env.API_BASE||'http://127.0.0.1:8080')+'/api';
const suffix=crypto.randomBytes(5).toString('hex');
async function api(path,method='GET',body,token){
 const res=await fetch(BASE+path,{method,headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 const json=await res.json();
 if(!res.ok)throw new Error(path+': '+res.status+' '+JSON.stringify(json));return json;
}
const d=await api('/register','POST',{username:'driver_'+suffix,password:'strongTemporaryPassword987'});
const p=await api('/register','POST',{username:'pass_'+suffix,password:'strongTemporaryPassword456'});
await api('/profile','POST',{name:'Водитель Тест',phone:'+79991110000',car:'Toyota'},d.token);
await api('/profile','POST',{name:'Пассажир Тест',phone:'+79992220000'},p.token);
const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10),key='ride_'+suffix+'_12345';
const rideBody={from:'Москва',to:'Казань',date,time:'11:30',seats:2,price:1200,car:'Toyota',clientKey:key};
const r=await api('/rides','POST',rideBody,d.token);
assert.equal((await api('/rides','POST',rideBody,d.token)).id,r.id);
assert((await api('/state','GET',undefined,p.token)).rides.some(x=>x.id===r.id));
const driverId=(await api('/state','GET',undefined,d.token)).currentUserId;
let passState=await api('/state','GET',undefined,p.token);
assert.equal(passState.users.find(u=>u.id===driverId).phone,'','Phone must be hidden before acceptance');
const request=await api('/requests','POST',{rideId:r.id},p.token);
assert((await api('/state','GET',undefined,d.token)).requests.some(q=>q.id===request.id));
await api('/requests/'+request.id+'/accept','POST',{},d.token);
passState=await api('/state','GET',undefined,p.token);
assert.equal(passState.requests.find(q=>q.id===request.id).status,'accepted');
assert.equal(passState.users.find(u=>u.id===driverId).phone,'+79991110000');
await api('/messages','POST',{rideId:r.id,toId:driverId,text:'Здравствуйте!'},p.token);
assert((await api('/state','GET',undefined,d.token)).messages.some(m=>m.text==='Здравствуйте!'));
const forbidden=await fetch(BASE+'/admin/overview',{headers:{Authorization:'Bearer '+p.token}});
assert.equal(forbidden.status,403);
await api('/rides/'+r.id+'/cancel','POST',{},d.token);
assert.equal((await api('/state','GET',undefined,p.token)).requests.find(q=>q.id===request.id).status,'cancelled');
console.log('PASS: cross-client rides, requests, confirmation, gated phone/chat, idempotency, admin security, cancellation');

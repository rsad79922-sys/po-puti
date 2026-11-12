/**
 * Isolated photo upload regression: disposable SQLite, no real user data.
 * Checks avatar + car photo persistence, size limits, and image signature validation.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import crypto from 'node:crypto';

const temp=await mkdtemp(join(tmpdir(),'po-puti-photos-'));
const port=20000+Math.floor(Math.random()*30000);
const base='http://127.0.0.1:'+port+'/api';
const server=spawn(process.execPath,[new URL('../server/server.mjs',import.meta.url).pathname],{
 env:{...process.env,DATA_DIR:temp,PORT:String(port),HOST:'127.0.0.1',ADMIN_USERNAME:'',ADMIN_PASSWORD:''},
 stdio:['ignore','pipe','pipe']
});
let output='';
server.stderr.on('data',part=>output+=String(part));
async function call(path,method='GET',data,token){
 const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
 return {status:response.status,data:await response.json()};
}
function expectOk(result,label){assert.equal(result.status,200,label+': '+JSON.stringify(result.data));return result.data}
const base64=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46]).toString('base64');
const photo='data:image/jpeg;base64,'+base64;
try{
 let ready=false;
 for(let i=0;i<80;i++){
  if(server.exitCode!==null)throw Error('Server exited: '+output);
  try{if((await call('/health')).status===200){ready=true;break}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 assert(ready,'Could not start test server: '+output);
 const username='photo_'+crypto.randomBytes(5).toString('hex');
 const user=expectOk(await call('/register','POST',{username,password:'correct-horse-battery-staple'}),'register');
 const token=user.token;
 expectOk(await call('/profile','POST',{name:'Фотограф',car:'Lada',phone:'',photo},token),'save avatar');
 let state=expectOk(await call('/state','GET',undefined,token),'state');
 assert.equal(state.users.find(u=>u.id===user.user.id).photo,photo,'avatar must persist across API requests');
 const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 const rideData={from:'Ижевск',to:'Казань',date,time:'12:30',seats:2,price:950,car:'Lada',photo};
 const ride=expectOk(await call('/rides','POST',rideData,token),'publish with photo');
 state=expectOk(await call('/state','GET',undefined,token),'reload');
 assert.equal(state.rides.find(r=>r.id===ride.id).photo,photo,'car photo must survive new /state request');
 assert.equal((await call('/profile','POST',{name:'Фотограф',photo:'data:image/svg+xml;base64,PHN2Zy8+'},token)).status,400,'SVG must be rejected');
 assert.equal((await call('/rides','POST',{...rideData,photo:'data:image/jpeg;base64,'+Buffer.alloc(120001,0xff).toString('base64')},token)).status,413,'oversized car photo must be rejected');
 assert.equal((await call('/rides','POST',{...rideData,photo:'data:image/jpeg;base64,'+Buffer.from('not a jpeg').toString('base64')},token)).status,400,'spoofed JPEG must be rejected');
 const rideWithoutPhoto=expectOk(await call('/rides','POST',{...rideData,photo:''},token),'publish without photo');
 state=expectOk(await call('/state','GET',undefined,token),'state after empty');
 assert.equal(state.rides.find(r=>r.id===rideWithoutPhoto.id).photo,'','optional photo must be optional');
 console.log('PASS: profile avatar and car photo survive real isolated SQLite, empty/photo size/type validation works');
}finally{
 server.kill('SIGTERM');
 await new Promise(resolve=>{if(server.exitCode!==null||server.signalCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,4000)});
 await rm(temp,{recursive:true,force:true});
}

import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import crypto from 'node:crypto';
const dir=await mkdtemp(join(tmpdir(),'po-puti-audit-'));
const port=20000+Math.floor(Math.random()*30000);
const endpoint='http://127.0.0.1:'+port+'/api';
const server=spawn(process.execPath,[new URL('../server/server.mjs',import.meta.url).pathname],{
 env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dir,ADMIN_USERNAME:'',ADMIN_PASSWORD:'',APP_ORIGINS:'https://vputipoputka.ru,https://localhost'},stdio:['ignore','pipe','pipe']
});
let err='';server.stderr.on('data',c=>err+=c);
async function req(path,method='GET',body,token,origin){
 const r=await fetch(endpoint+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{})},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const txt=await r.text();
 let parsed={};try{parsed=JSON.parse(txt)}catch{}
 return {status:r.status,body:parsed,headers:r.headers};
}
async function success(path,method,body,token,origin){
 const response=await req(path,method,body,token,origin);
 assert.equal(response.status,200,path+': '+JSON.stringify(response.body));
 return response.body;
}
try{
 let started=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error('Server exited: '+err);try{if((await req('/health')).status===200){started=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
 assert(started,'Cannot start test server: '+err);
 const cors=await req('/state','OPTIONS',undefined,null,'https://localhost');
 assert.equal(cors.status,204,'Android-origin OPTIONS preflight');
 assert.equal(cors.headers.get('access-control-allow-origin'),'https://localhost');
 assert.match(cors.headers.get('access-control-allow-headers')||'',/Authorization/);
 assert.equal((await req('/state','OPTIONS',undefined,null,'https://evil.example')).status,403,'arbitrary Android origin must not be allowed');
 assert.equal((await req('/state')).status,401,'state requires login');
 assert.equal((await req('/register','POST','null')).status,400,'reject JSON primitive before handler');
 assert.equal((await req('/register','POST','[]')).status,400,'reject JSON array before handler');
 const suffix=crypto.randomBytes(5).toString('hex');
 const driver=await success('/register','POST',{username:'audit_'+suffix,password:'audit-test-password123'},null,'https://localhost');
 const login=await success('/login','POST',{username:'audit_'+suffix,password:'audit-test-password123'});
 assert(login.token,'login must work with asynchronous password hashing');
 const dead=(await req('/rides','POST',{from:'Ижевск',to:'Казань',date:'2027-02-31',time:'12:30',seats:2,price:100,car:'Lada'},driver.token));
 assert.equal(dead.status,400,'invalid calendar date must be rejected');
 const badTime=(await req('/rides','POST',{from:'Ижевск',to:'Казань',date:'2027-06-18',time:'99:99',seats:2,price:100,car:'Lada'},driver.token));
 assert.equal(badTime.status,400,'invalid hour/minute must be rejected');
 const goodDate=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 const ride=await success('/rides','POST',{from:'Ижевск',to:'Казань',date:goodDate,time:'12:30',seats:2,price:100,car:'Lada',clientKey:'key_'+suffix},driver.token);
 assert(ride.id,'new ride ID');
 const passenger=await success('/register','POST',{username:'guest_'+suffix,password:'audit-test-password123'});
 const passengerState=await success('/state','GET',undefined,passenger.token,'https://localhost');
 assert(passengerState.rides.some(r=>r.id===ride.id),'Android-origin API and PWA must see same ride');
 const oldDate=new Date(Date.now()-15*86400000).toISOString().slice(0,10);
 // Date is validated at creation, so advance a ride through the isolated SQLite
 // database rather than publishing an invalid past trip with an API request.
 console.log('PASS: login, Android CORS, auth, calendar validation, shared rides and disposable SQLite');
}finally{
 server.kill('SIGTERM');
 await new Promise(resolve=>{if(server.exitCode!==null||server.signalCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,4000)});
 await rm(dir,{recursive:true,force:true});
}

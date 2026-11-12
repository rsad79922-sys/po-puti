/**
 * Read-only-to-production server routing integration test.
 * Runs its own isolated Node process on a random loopback port,
 * using a temporary SQLite directory (never production data).
 */
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

const dir=await mkdtemp(join(tmpdir(),'po-puti-routing-'));
const port=20000+Math.floor(Math.random()*30000);
const base='http://127.0.0.1:'+port;
const child=spawn(process.execPath,[new URL('../server/server.mjs',import.meta.url).pathname],{
 env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',ADMIN_USERNAME:'',ADMIN_PASSWORD:''},
 stdio:['ignore','pipe','pipe']
});
let output='';
child.stderr.on('data',chunk=>output+=chunk.toString());
try {
 let ready=false;
 for(let i=0;i<80;i++){
  if(child.exitCode!==null)throw new Error('Server exited early: '+output);
  try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(700)});if(r.ok){ready=true;break}}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(ready,'Isolated backend did not start: '+output);
 async function check(path,accept='text/html'){
  return fetch(base+path,{headers:{Accept:accept},redirect:'manual'});
 }
 const main=await check('/');
 assert.equal(main.status,200,'home must be HTTP 200');
 const markup=await main.text();
 assert.match(markup,/<div id="app"/,'home must serve application entry HTML');
 assert.equal(main.headers.get('cache-control'),'no-store','HTML must not persist as stale PWA shell');
 for(const path of ['/index.html','/login','/search','/trips','/profile','/notifications','/admin','/ride/example','/reviews/example','/chat/ride/user']){
  const response=await check(path);
  assert.equal(response.status,200,path+' must return SPA shell');
  assert.match(await response.text(),/<div id="app"/,path+' must contain app root');
 }
 const missing=await check('/missing-file.js','*/*');
 assert.equal(missing.status,404,'missing JS asset must not be silently replaced with HTML');
 assert.match((await missing.json()).error,/Файл не найден/);
 const apiMissing=await check('/api/unknown','application/json');
 assert.equal(apiMissing.status,401,'unauthenticated API must be protected');
 const directBad=await check('/totally-unknown-route','text/html');
 assert.equal(directBad.status,404,'unrecognized routes must return 404');
 const head=await fetch(base+'/',{method:'HEAD'});
 assert.equal(head.status,200);
 assert.equal(await head.text(),'');
 assert.equal(head.headers.get('content-type'),'text/html; charset=utf-8');
 // Android Capacitor 7 uses https://localhost as its WebView origin.
 const preflight=await fetch(base+'/api/state',{method:'OPTIONS',headers:{
  Origin:'https://localhost',
  'Access-Control-Request-Method':'GET',
  'Access-Control-Request-Headers':'Authorization'
 }});
 assert.equal(preflight.status,204,'Android preflight rejected');
 assert.equal(preflight.headers.get('access-control-allow-origin'),'https://localhost','Android origin not allowed');
 assert.match(preflight.headers.get('access-control-allow-headers')||'',/Authorization/i,'Android bearer token preflight blocked');
 const untrusted=await fetch(base+'/api/state',{method:'OPTIONS',headers:{Origin:'https://untrusted.example'}});
 assert.equal(untrusted.status,403,'untrusted origins must remain blocked');
 const config=await check('/config.js','*/*');
 assert.equal(config.status,200);
 assert.match(await config.text(),/PO_PUTI_BACKEND\s*=\s*true/);
 console.log('PASS: isolated production server root, direct SPA links, missing assets, API protection, HEAD and cache');
}finally{
 child.kill('SIGTERM');
 await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,4000)});
 await rm(dir,{recursive:true,force:true});
}

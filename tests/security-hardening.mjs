import assert from 'node:assert/strict';
import {stat} from 'node:fs/promises';
import {isolatedServer} from './helpers/server.mjs';
const app=await isolatedServer({APP_ORIGINS:'https://localhost',RELEASE_SHA:'test-release'});
try{
 const request=(path,body,headers={})=>fetch(app.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const password='integration-test-'+crypto.randomUUID();
 const registration=await request('/register',{username:'cookie_user',password},{'X-Po-Puti-Session':'cookie'});
 assert.equal(registration.status,200);
 const user=await registration.json();assert.equal(user.token,undefined,'cookie login must not expose a bearer token');
 const cookie=registration.headers.get('set-cookie');
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Path=\/api/);
 const auth={Cookie:cookie.split(';')[0]};
 assert.equal((await request('/state',undefined,auth)).status,200);
 assert.equal((await request('/profile',{name:'csrf'}, {...auth,Origin:'https://localhost'})).status,403,'allowed native origin cannot use a web cookie');
 assert.equal((await request('/profile',{name:'csrf'}, {...auth,'Sec-Fetch-Site':'cross-site'})).status,403);
 const form=await fetch(app.base+'/api/profile',{method:'POST',headers:auth,body:'name=csrf'});assert.equal(form.status,415);
 for(const invalid of [null,{},'x'.repeat(129)])assert.equal((await request('/login',{username:'cookie_user',password:invalid})).status,401);
 const concurrent=await Promise.all(Array.from({length:12},()=>request('/login',{username:'cookie_user',password})));
 assert(concurrent.some(r=>r.status===503),'hashing overload must be rejected rather than queued without bound');
 assert(concurrent.every(r=>r.status===200||r.status===503));
 assert.equal((await request('/health')).status,200,'health stays available after auth burst');
 const legacy=await request('/login',{username:'cookie_user',password});const token=(await legacy.json()).token;assert(token);
 const migrated=await request('/session',{}, {Authorization:'Bearer '+token,'X-Po-Puti-Session':'cookie'});
 assert.equal(migrated.status,200);assert.equal((await migrated.json()).token,undefined);
 assert.equal((await request('/state',undefined,{Authorization:'Bearer '+token})).status,401,'migrated bearer must be revoked');
 assert.equal((await request('/logout',{},auth)).status,200);
 assert.equal((await request('/state',undefined,auth)).status,401,'logout revokes session server side');
 const health=await (await request('/health')).json();assert.equal(health.ok,true);assert.equal(health.release,'test-release');
 const shell=await fetch(app.base+'/profile',{headers:{Accept:'text/html'}});
 assert.match(shell.headers.get('content-security-policy'),/script-src 'self' 'sha256-/);
 assert.equal(shell.headers.get('x-frame-options'),'DENY');
 assert.equal((await stat(app.dir+'/po-puti.sqlite')).mode&0o077,0,'database must be private');
 app.child.kill('SIGTERM');await new Promise(r=>app.child.once('exit',r));assert.equal(app.child.exitCode,0,'SIGTERM exits cleanly');
 console.log('PASS: cookie auth, CSRF, legacy session migration/revocation, login bounds, CSP, private DB, health and graceful shutdown');
}finally{await app.stop()}
const secure=await isolatedServer({PUBLIC_ORIGIN:'https://app.example'});
try{
 const response=await fetch(secure.base+'/api/register',{method:'POST',headers:{Origin:'https://app.example','Content-Type':'application/json','X-Po-Puti-Session':'cookie'},body:JSON.stringify({username:'secure_user',password:'test-'+crypto.randomUUID()})});
 assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/; Secure/);
}finally{await secure.stop()}

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {isolatedServer} from './helpers/server.mjs';
import {totp} from '../server/admin-mfa.mjs';
const app=await isolatedServer({ADMIN_MFA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),ADMIN_MFA_REQUIRED:'true'});let db;
async function call(path,body,token){const r=await fetch(app.base+'/api'+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
try{
 const password='test-'+randomUUID();const admin=(await call('/register',{username:'secure_admin',password})).data,other=(await call('/register',{username:'secure_other',password})).data;
 assert.equal((await call('/register',{username:'terms_bypass',password,clientVersion:5})).status,400);
 const promote=spawnSync(process.execPath,['scripts/admin-user.mjs','--user-id',admin.user.id,'--reason','Isolated owner fixture'],{env:{...process.env,DATA_DIR:app.dir},encoding:'utf8'});assert.equal(promote.status,0,promote.stderr);
 assert.equal((await call('/admin/v3/summary',undefined,admin.token)).status,403,'mandatory MFA blocks password-only session');
 assert.equal((await call('/admin/mfa/enroll',{},admin.token)).status,401,'enrollment requires password again');
 assert.equal((await call('/admin/mfa/enroll',{password},other.token)).status,403,'ordinary account cannot enroll administrator MFA');
 const setup=await call('/admin/mfa/enroll',{password},admin.token);assert.equal(setup.status,200);const step=Math.floor(Date.now()/30000);
 assert.equal((await call('/admin/mfa/verify',{code:totp(setup.data.secret,step)},admin.token)).status,200);
 assert.equal((await call('/admin/v3/summary',undefined,admin.token)).status,200);
 assert.equal((await call('/login',{username:'secure_admin',password})).status,401);
 const login=await call('/login',{username:'secure_admin',password,mfaCode:totp(setup.data.secret,step+1)});assert.equal(login.status,200);
 assert.equal((await call('/admin/v3/summary',undefined,login.data.token)).status,200);
 assert.equal((await call('/login',{username:'secure_admin',password,mfaCode:totp(setup.data.secret,step+1)})).status,401,'same OTP cannot create another session');
 const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#42caba'}}).jpeg().toBuffer();const photo='data:image/jpeg;base64,'+bytes.toString('base64');
 assert.equal((await call('/profile',{name:'Владелец фото',photo},other.token)).status,200);
 db=new DatabaseSync(app.dir+'/po-puti.sqlite');const url=db.prepare('SELECT photo FROM users WHERE id=?').get(other.user.id).photo;
 assert.equal((await call('/profile',{name:'Другой аккаунт',photo:url},login.data.token)).status,403,'known file URL is not upload ownership');
 assert.equal((await call('/account/deletion-request',{confirmation:'no'},other.token)).status,400);
 await call('/account/deletion-request',{confirmation:'DELETE_MY_ACCOUNT'},other.token);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,2);
 const recover=spawnSync(process.execPath,['scripts/reset-admin-mfa.mjs','--user-id',admin.user.id,'--reason','Isolated recovery rehearsal'],{env:{...process.env,DATA_DIR:app.dir},encoding:'utf8'});assert.equal(recover.status,0,recover.stderr);assert.equal((await call('/admin/v3/summary',undefined,login.data.token)).status,401);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='owner_mfa_recovery'").get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,2);
 console.log('PASS: v5 consent validation, mandatory MFA, password re-entry, OTP replay/session protection, photo ownership and audited recovery without user deletion');
}finally{db?.close();await app.stop()}

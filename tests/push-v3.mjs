import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {randomUUID} from 'node:crypto';
import {isolatedServer} from './helpers/server.mjs';import {lifecycle} from '../server/lifecycle.mjs';import {createPush,pushApi,processPush,validWebEndpoint} from '../server/push.mjs';
import {writeFile} from 'node:fs/promises';
import * as webpush from 'web-push';
const app=await isolatedServer();app.child.kill('SIGTERM');await new Promise(r=>app.child.once('exit',r));const db=new DatabaseSync(app.dir+'/po-puti.sqlite');
let time=Date.now();const keys=webpush.generateVAPIDKeys();const delivered=[];
const transport=createPush({env:{VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'mailto:test@example.invalid',FCM_PROJECT_ID:'test',FCM_SERVICE_ACCOUNT_JSON:'{}'},sendWeb:async(s,p)=>delivered.push({platform:'web',s,p}),sendAndroid:async(token,p)=>delivered.push({platform:'android',token,p})});
const l=lifecycle(db,{clock:()=>time,pushAvailable:transport.available});
const run=(s,...a)=>db.prepare(s).run(...a),q=(s,...a)=>db.prepare(s).get(...a);
for(const id of ['alice','bob'])run('INSERT INTO users(id,username,salt,hash,name,created) VALUES(?,?,?,?,?,?)',id,id,'x','x',id,time);
const actor={id:'alice'},web={deviceId:'web_device_12345',platform:'web',subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/'+randomUUID(),keys:{p256dh:keys.publicKey,auth:'abcdefghijklmnopqrstuv'}}};
try{
 for(const url of ['http://127.0.0.1/','https://localhost/','https://fcm.googleapis.com.attacker.invalid/','https://fcm.googleapis.com:444/token','https://user:pass@fcm.googleapis.com/token'])assert.throws(()=>validWebEndpoint(url));
 const first=pushApi(l,actor,'/api/push/subscribe','POST',web);assert.equal(pushApi(l,actor,'/api/push/subscribe','POST',web).id,first.id);
 pushApi(l,actor,'/api/push/subscribe','POST',{deviceId:'android_device_123',platform:'android',token:'FCM_'+randomUUID()});
 assert.throws(()=>pushApi(l,{id:'bob'},'/api/push/subscribe','POST',web),e=>e.status===409);
 l.event(actor.id,'ride_confirmation','one-event','PRIVATE REVIEW TEXT','SECRET COMPLAINT','/notifications');l.event(actor.id,'ride_confirmation','one-event','duplicate','duplicate','/notifications');
 assert.equal(q('SELECT COUNT(*) n FROM notifications').n,1);assert.equal(q('SELECT COUNT(*) n FROM push_outbox').n,2);
 await processPush(l,transport);await processPush(l,transport);assert.equal(delivered.length,2);assert.equal(new Set(delivered.map(d=>d.platform)).size,2);
 for(const d of delivered){assert(!JSON.stringify(d.p).includes('PRIVATE'));assert(!JSON.stringify(d.p).includes('SECRET'));assert.equal(d.p.badge,1);assert.equal(d.p.path,'/notifications')}
 l.event(actor.id,'review_reminder','two-event','Reminder','body','/notifications');
 await processPush(l,{deliver:async()=>{throw Object.assign(Error('endpoint/token must not be logged'),{statusCode:503})}});
 assert.equal(q("SELECT COUNT(*) n FROM push_outbox WHERE status='retry'").n,2);assert.equal(q("SELECT last_error FROM push_outbox WHERE status='retry'").last_error,'delivery_status_503');
 time+=3*60000;await processPush(l,transport);assert.equal(delivered.length,4);
 // Expired subscriptions are disabled, history retained and no duplicate retry after restart.
 l.event(actor.id,'review_published','expired-event','review','private','/notifications');
 await processPush(l,{deliver:async()=>{throw Object.assign(Error('gone'),{statusCode:410})}});
 assert.equal(q('SELECT COUNT(*) n FROM push_subscriptions WHERE active=1').n,0);
 pushApi(l,actor,'/api/push/subscribe','POST',web);l.event(actor.id,'review_reminder','logout-event','title','text','/notifications');
 pushApi(l,actor,'/api/push/unsubscribe','POST',{deviceId:web.deviceId});const count=delivered.length;await processPush(l,transport);assert.equal(delivered.length,count,'logout must cancel queued device delivery');
 assert.equal(q('SELECT active FROM push_subscriptions WHERE id=?',first.id).active,0);
 const credentials={type:'service_account',project_id:'example-project',client_email:'sender@example-project.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----\nfixture-only-not-used-to-sign\n-----END PRIVATE KEY-----'};
 const credentialPath=app.dir+'/fcm-test.json';await writeFile(credentialPath,JSON.stringify(credentials),{mode:0o600});
 assert.equal(createPush({env:{FCM_PROJECT_ID:'example-project',FCM_SERVICE_ACCOUNT_JSON:credentialPath}}).available().android,true,'private credential file path is supported');
 assert.throws(()=>createPush({env:{FCM_PROJECT_ID:'different-project',FCM_SERVICE_ACCOUNT_JSON:credentialPath}}),/Invalid FCM/);
 assert.equal(createPush({env:{}}).available().web,false);assert.equal(createPush({env:{}}).available().android,false);
 console.log('PASS: multi-device Web/FCM dispatch, generic lock-screen payloads, deduplication, retry, invalid-token retirement, logout, badge and SSRF protection');
}finally{db.close();await app.stop()}

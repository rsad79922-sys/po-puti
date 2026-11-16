import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {isolatedServer} from './helpers/server.mjs';
import {lifecycle} from '../server/lifecycle.mjs';
import {createPush,pushApi,processPush} from '../server/push.mjs';
const app=await isolatedServer();app.child.kill('SIGTERM');await new Promise(resolve=>app.child.once('exit',resolve));
const db=new DatabaseSync(app.dir+'/po-puti.sqlite');let calls=[],status=200;
const env={RUSTORE_PUSH_PROJECT_ID:'fixture-project',RUSTORE_PUSH_SERVICE_TOKEN:'fixture-private-service-token'};
const transport=createPush({env,fetcher:async(url,options)=>{calls.push({url,options});return new Response('{}',{status})}});
const l=lifecycle(db,{pushAvailable:transport.available});
try{
 assert.equal(transport.available().android,false,'RuStore must never enable the legacy FCM switch');assert.equal(transport.available().rustore,true);
 db.prepare("INSERT INTO users(id,username,salt,hash,name,created) VALUES('fixture','fixture','x','x','fixture',?)").run(Date.now());
 const actor={id:'fixture'},data={deviceId:'rustore-device-1234',platform:'android',provider:'rustore',token:'fixture-device-token-abcdefghijklmnopqrstuvwxyz'};
 assert.throws(()=>pushApi(l,actor,'/api/push/subscribe','POST',{...data,provider:'fcm'}),e=>e.status===503,'no silent fallback to FCM');
 const subscription=pushApi(l,actor,'/api/push/subscribe','POST',data);assert.equal(pushApi(l,actor,'/api/push/subscribe','POST',data).id,subscription.id);
 l.event(actor.id,'review_published','rustore-fixture','Private review text','Private phone','/notifications');await processPush(l,transport);
 assert.equal(calls.length,1);const request=calls[0];assert.equal(request.url,'https://vkpns.rustore.ru/v1/projects/fixture-project/messages:send');assert.equal(request.options.redirect,'error');assert.equal(request.options.headers.Authorization,'Bearer '+env.RUSTORE_PUSH_SERVICE_TOKEN);
 const message=JSON.parse(request.options.body).message;assert.equal(message.token,data.token);assert.equal(message.android.ttl,'86400s');assert.equal(message.data.path,'/notifications');assert.equal(message.data.recipientId,actor.id);assert.equal(message.notification,undefined,'data-only delivery lets native policy suppress stale notifications after logout');assert.equal(message.android.notification,undefined);assert(!request.options.body.includes('Private'));assert(!JSON.stringify(transport.available()).includes(env.RUSTORE_PUSH_SERVICE_TOKEN));
 status=404;l.event(actor.id,'review_reminder','rustore-invalid','private','private','/notifications');await processPush(l,transport);assert.equal(db.prepare('SELECT active FROM push_subscriptions WHERE id=?').get(subscription.id).active,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM push_outbox WHERE status='failed'").get().n,1);
 assert.equal(createPush({env:{RUSTORE_PUSH_PROJECT_ID:'../untrusted',RUSTORE_PUSH_SERVICE_TOKEN:'fixture'}}).available().rustore,false);
 console.log('PASS: official RuStore HTTP transport, separate provider subscription, no FCM fallback, generic payloads, server-only service token and invalid-device retirement (isolated provider fixture; no live delivery claim)');
}finally{db.close();await app.stop()}

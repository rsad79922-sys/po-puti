import * as webpush from 'web-push';
import {GoogleAuth,JWT} from 'google-auth-library';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fail} from './lifecycle.mjs';
export function validWebEndpoint(value){
 let url;try{url=new URL(value)}catch{throw fail('Некорректная push-подписка')}
 const domains=['fcm.googleapis.com','push.services.mozilla.com','notify.windows.com','web.push.apple.com'];
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!domains.some(d=>url.hostname===d||url.hostname.endsWith('.'+d)))throw fail('Неизвестный сервер Web Push');
 return url.href;
}
export function createPush({env=process.env,sendWeb,sendAndroid,sendRustore,fetcher=fetch}={}){
 const webReady=!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);
 const androidReady=!!sendAndroid||!!(env.FCM_PROJECT_ID&&(env.FCM_SERVICE_ACCOUNT_JSON||env.GOOGLE_APPLICATION_CREDENTIALS));
 const rustoreReady=!!sendRustore||!!(/^[A-Za-z0-9_-]{1,200}$/.test(env.RUSTORE_PUSH_PROJECT_ID||'')&&env.RUSTORE_PUSH_SERVICE_TOKEN);
 let auth;
 if(androidReady&&!sendAndroid){
  const config=env.FCM_SERVICE_ACCOUNT_JSON;const credentials=JSON.parse(config?.trim().startsWith('{')?config:readFileSync(config||env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'));
  if(credentials.type!=='service_account'||!String(credentials.client_email||'').endsWith('.gserviceaccount.com')||!String(credentials.private_key||'').includes('BEGIN PRIVATE KEY')||credentials.project_id!==env.FCM_PROJECT_ID)throw Error('Invalid FCM service-account configuration');
  auth=new GoogleAuth({authClient:new JWT({email:credentials.client_email,key:credentials.private_key,scopes:['https://www.googleapis.com/auth/firebase.messaging']})});
 }
 const available=()=>({web:webReady,android:androidReady,rustore:rustoreReady,rustoreProjectId:rustoreReady?env.RUSTORE_PUSH_PROJECT_ID||null:null,androidProviders:{fcm:androidReady,rustore:rustoreReady},vapidPublicKey:webReady?env.VAPID_PUBLIC_KEY:null});
 async function deliver(sub,payload){
  if(sub.platform==='web'){
   if(!webReady&&!sendWeb)throw Object.assign(Error('Push not configured'),{retryable:false});
   const sender=sendWeb||((s,p)=>webpush.sendNotification(s,JSON.stringify(p),{vapidDetails:{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY},TTL:86400,timeout:8000}));
   return sender({endpoint:sub.address,keys:JSON.parse(sub.keys_json)},payload);
  }
  const provider=JSON.parse(sub.keys_json||'{}').provider||'fcm';
  if(provider==='rustore'){
   if(!rustoreReady)throw Object.assign(Error('RuStore push not configured'),{retryable:false});
   if(!sub.address.startsWith('rustore:'))throw Object.assign(Error('Invalid RuStore subscription'),{retryable:false});
   const token=sub.address.slice(8);if(sendRustore)return sendRustore(token,payload);
   try{
    const response=await fetcher('https://vkpns.rustore.ru/v1/projects/'+encodeURIComponent(env.RUSTORE_PUSH_PROJECT_ID)+'/messages:send',{
     method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+env.RUSTORE_PUSH_SERVICE_TOKEN},redirect:'error',signal:AbortSignal.timeout(10000),
     body:JSON.stringify({message:{token,data:{path:payload.path,notificationId:payload.notificationId,recipientId:payload.recipientId},android:{ttl:'86400s'}}})
    });
    await response.body?.cancel();
    if(!response.ok)throw Object.assign(Error('RuStore delivery failed'),{statusCode:response.status});
    return;
   }catch(error){throw Object.assign(Error('RuStore delivery failed'),{statusCode:error.statusCode||503})}
  }
  if(provider!=='fcm')throw Object.assign(Error('Unknown native push provider'),{retryable:false});
  if(!androidReady&&!sendAndroid)throw Object.assign(Error('Native push not configured'),{retryable:false});
  if(sendAndroid)return sendAndroid(sub.address,payload);
  const client=await auth.getClient();
  try{return await client.request({url:'https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(env.FCM_PROJECT_ID)+'/messages:send',method:'POST',timeout:10000,data:{message:{token:sub.address,notification:{title:payload.title,body:payload.body},data:{path:payload.path,notificationId:payload.notificationId},android:{priority:'high',notification:{channel_id:'trip_updates',notification_count:payload.badge,tag:payload.notificationId}}}}})}
  catch(e){const invalid=e.response?.data?.error?.details?.some(x=>x.errorCode==='UNREGISTERED');throw Object.assign(Error('FCM delivery failed'),{statusCode:invalid?410:e.response?.status||503})}
 }
 return {available,deliver};
}
export function pushApi(l,actor,path,method,data){
 const {get,run,tx,clock}=l;
 if(path==='/api/push/config'&&method==='GET')return {...l.pushAvailable(),iosHomeScreenRequired:true};
 if(path==='/api/push/subscribe'&&method==='POST')return tx(()=>{
  const device=String(data.deviceId||'');if(!/^[a-zA-Z0-9_-]{10,100}$/.test(device))throw fail('Неверный идентификатор устройства');
  if(!['web','android'].includes(data.platform))throw fail('Неверная платформа');
  const provider=data.platform==='android'?String(data.provider||'fcm'):null;
  if(provider&&!['fcm','rustore'].includes(provider))throw fail('Неверный транспорт уведомлений');
  if(!(provider==='rustore'?l.pushAvailable().rustore:l.pushAvailable()[data.platform]))throw fail('Push ещё не настроен на сервере',503);
  let address,keys={};
  if(data.platform==='web'){
   address=validWebEndpoint(data.subscription?.endpoint);
   keys=data.subscription?.keys||{};
   if(!/^[a-zA-Z0-9_-]{80,100}={0,2}$/.test(keys.p256dh||'')||!/^[a-zA-Z0-9_-]{20,30}={0,2}$/.test(keys.auth||''))throw fail('Некорректные ключи Web Push');
  }else{address=String(data.token||'');if(!/^[A-Za-z0-9_:\-.]{30,4096}$/.test(address))throw fail('Неверный push token');keys={provider};if(provider==='rustore')address='rustore:'+address;}
  const other=get('SELECT * FROM push_subscriptions WHERE address=?',address);
  if(other&&other.user_id!==actor.id&&other.active)throw fail('Устройство связано с другой сессией. Сначала отключите уведомления в ней.',409);
  const own=get('SELECT * FROM push_subscriptions WHERE user_id=? AND device_id=? AND platform=?',actor.id,device,data.platform);
  if(other&&!own){run('UPDATE push_outbox SET status=\'cancelled\' WHERE subscription_id=? AND status IN (\'pending\',\'retry\',\'sending\')',other.id);run('UPDATE push_subscriptions SET user_id=?,device_id=?,keys_json=?,active=1 WHERE id=?',actor.id,device,JSON.stringify(keys),other.id);return {id:other.id}}
  if(own){if(other&&other.id!==own.id)throw fail('Подписка уже существует',409);run('UPDATE push_subscriptions SET address=?,keys_json=?,active=1 WHERE id=?',address,JSON.stringify(keys),own.id);return {id:own.id}}
  const id=randomUUID();run('INSERT INTO push_subscriptions(id,user_id,device_id,platform,address,keys_json,created_at,active) VALUES(?,?,?,?,?,?,?,1)',id,actor.id,device,data.platform,address,JSON.stringify(keys),clock());return {id};
 });
 if(path==='/api/push/unsubscribe'&&method==='POST')return tx(()=>{
  if(!data.deviceId)throw fail('Укажите устройство');
  run('UPDATE push_outbox SET status=\'cancelled\' WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE user_id=? AND device_id=?) AND status IN (\'pending\',\'retry\',\'sending\')',actor.id,String(data.deviceId));
  run('UPDATE push_subscriptions SET active=0 WHERE user_id=? AND device_id=?',actor.id,String(data.deviceId));return {ok:true};
 });
 return null;
}
export async function processPush(l,transport,{limit=25,shouldStop=()=>false}={}){
 const {get,run,tx,clock}=l;
 const start=clock();run("INSERT INTO background_state(name,last_started_at) VALUES('push',?) ON CONFLICT(name) DO UPDATE SET last_started_at=excluded.last_started_at",start);
 for(let i=0;i<limit&&!shouldStop();i++){
  const job=tx(()=>{
   const j=get("SELECT * FROM push_outbox WHERE ((status IN ('pending','retry')) OR status='sending') AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 1",clock());
   if(!j)return null;run("UPDATE push_outbox SET status='sending',attempts=attempts+1,next_attempt_at=? WHERE id=?",clock()+120000,j.id);return {...j,attempts:j.attempts+1};
  });if(!job)break;
  const sub=get('SELECT * FROM push_subscriptions WHERE id=?',job.subscription_id),note=get('SELECT * FROM notifications WHERE id=?',job.notification_id);
  if(!sub?.active||!note||sub.user_id!==note.recipient_id||get('SELECT blocked_at FROM users WHERE id=?',sub.user_id)?.blocked_at){run("UPDATE push_outbox SET status='cancelled' WHERE id=?",job.id);continue}
  const badge=get('SELECT COUNT(*) n FROM notifications WHERE recipient_id=? AND read=0',sub.user_id).n;
  const titles={ride_confirmation:'Поездка состоялась?',review_published:'Опубликован отзыв',review_reminder:'Оцените поездку',complaint_result:'Обращение рассмотрено',push_test:'Проверка уведомлений'};
  const payload={notificationId:note.id,title:titles[note.kind]||'По пути — новое уведомление',body:'Откройте приложение, чтобы посмотреть уведомление.',path:note.target_path||'/notifications',recipientId:note.recipient_id,badge};
  try{await transport.deliver(sub,payload);run("UPDATE push_outbox SET status='sent',delivered_at=?,last_error='' WHERE id=? AND status='sending'",clock(),job.id)}
  catch(error){
   const status=Number(error.statusCode||503),invalid=[404,410].includes(status),terminal=invalid||error.retryable===false||job.attempts>=5;
   run('UPDATE push_outbox SET status=?,next_attempt_at=?,last_error=? WHERE id=? AND status=\'sending\'',terminal?'failed':'retry',clock()+Math.min(32,2**job.attempts)*60000,'delivery_status_'+status,job.id);
   if(invalid)run('UPDATE push_subscriptions SET active=0 WHERE id=?',sub.id);
  }
 }
 run("UPDATE background_state SET last_finished_at=?,last_error='' WHERE name='push'",clock());
}

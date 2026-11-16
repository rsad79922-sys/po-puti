import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {chromium,webkit} from 'playwright';
import {isolatedServer} from './helpers/server.mjs';
const app=await isolatedServer({APP_ORIGINS:'https://localhost',RUSTORE_PUSH_PROJECT_ID:'fixture-project',RUSTORE_PUSH_SERVICE_TOKEN:'fixture-service-token'});let browser,db;
try{
 const engine=process.env.BROWSER_ENGINE||'chromium';browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}:{})});
 const context=await browser.newContext();await context.addInitScript(base=>{
  window.PO_PUTI_API_BASE=base;window.__session='';window.__push={activated:null,disabled:0,listeners:{}};
  window.Capacitor={getPlatform:()=> 'android',isPluginAvailable:()=>true,Plugins:{
   PoPutiFeatures:{getToken:async()=>({token:window.__session}),setToken:async p=>{window.__session=p.token},removeToken:async()=>{window.__session=''},showSearch:async()=>{},closeSearch:async()=>{},addListener:async()=>{}},
   PushNotifications:{addListener:async()=>{},removeAllDeliveredNotifications:async()=>{},register:async()=>{throw Error('FCM must not be selected')}},
   PoPutiRuStorePush:{status:async()=>({configured:true}),register:async()=>({token:'fixture-native-token-abcdefghijklmnopqrstuvwxyz'}),activate:async p=>{window.__push.activated=p},disable:async()=>{window.__push.disabled++;window.__push.activated=null},clearDelivered:async()=>{},addListener:async(name,callback)=>{window.__push.listeners[name]=callback}}
  }};
 },app.base);
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.base);await page.locator('[data-action=account-tab][data-tab=register]').click();await page.locator('#reg-username').fill('rustore_fixture');await page.locator('#reg-password').fill('test-'+randomUUID());await page.locator('[name=terms]').check();await page.locator('#login-form [type=submit]').click();await page.locator('#search-form').waitFor();
 await page.goto(app.base+'/#/profile');await page.locator('[data-v3-action=push-enable]:enabled').waitFor();await page.locator('[data-v3-action=push-enable]').click();await page.getByText('Уведомления RuStore включены для этого устройства.',{exact:true}).waitFor();
 db=new DatabaseSync(app.dir+'/po-puti.sqlite');const sub=db.prepare('SELECT * FROM push_subscriptions').get();assert.equal(JSON.parse(sub.keys_json).provider,'rustore');assert(sub.address.startsWith('rustore:'));const activated=await page.evaluate(()=>window.__push.activated);assert.equal(activated.userId,sub.user_id);assert(activated.sessionToken.length>30);
 await page.evaluate(()=>window.__push.listeners.notificationAction({recipientId:'wrong-account',path:'/admin'}));assert.equal(new URL(page.url()).hash,'#/profile');
 await page.evaluate(()=>window.__push.listeners.notificationAction({recipientId:db.currentUserId,path:'/notifications'}));await page.waitForURL('**/#/notifications');
 await page.goto(app.base+'/#/profile');await page.locator('[data-v3-action=push-disable]').click();await page.getByText('Уведомления отключены на этом устройстве.',{exact:true}).waitFor();assert.equal(db.prepare('SELECT active FROM push_subscriptions').get().active,0);assert.equal(await page.evaluate(()=>window.__push.activated),null);
 assert.deepEqual(errors,[]);console.log('PASS: RuStore provider choice without FCM, shared API subscription, session-bound opt-in, recipient-safe navigation and device unsubscribe');await context.close();
}finally{db?.close();await browser?.close();await app.stop()}

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium,webkit} from 'playwright';
import {isolatedServer} from './helpers/server.mjs';
const app=await isolatedServer({APP_ORIGINS:'https://localhost'});let browser;
try{
 const engine=process.env.BROWSER_ENGINE||'chromium';browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}:{})});
 const context=await browser.newContext();
 await context.addInitScript(base=>{
  window.PO_PUTI_API_BASE=base;window.__session='';window.__fcm={};
  window.Capacitor={getPlatform:()=> 'android',isPluginAvailable:n=>['PoPutiFeatures','PoPutiFcmPush','PoPutiRuStorePush'].includes(n),Plugins:{
   PoPutiFeatures:{getToken:async()=>({token:window.__session}),setToken:async p=>{window.__session=p.token},removeToken:async()=>{window.__session=''},showSearch:async()=>{},closeSearch:async()=>{},addListener:async()=>{}},
   PoPutiFcmPush:{register:async options=>{window.__fcm.options=options;return {token:'fixture-fcm-device-token-abcdefghijklmnopqrstuvwxyz'}},activate:async p=>{window.__fcm.active=p},disable:async()=>{window.__fcm.active=null}},
   PoPutiRuStorePush:{status:async()=>({configured:true,projectId:'fixture-rustore'}),register:async()=>{throw Object.assign(Error('Unavailable'),{code:'PROVIDER_UNAVAILABLE'})},disable:async()=>{},addListener:async()=>{}}
  }};
 },app.base);
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const config={web:false,android:true,rustore:true,rustoreProjectId:'fixture-rustore',androidClientConfig:{projectId:'fixture-project',senderId:'123456789',applicationId:'1:123456789:android:aabbcc',apiKey:'AIza'+'x'.repeat(35)}};
 const subscriptions=[];
 // Provider fixture tests client state and fallback; no external push project or device is contacted.
 await page.route('**/api/push/config',route=>route.fulfill({json:config}));
 await page.route('**/api/push/subscribe',route=>{subscriptions.push(route.request().postDataJSON());return route.fulfill({json:{id:'fixture-subscription'}})});
 await page.goto(app.base);await page.locator('[data-action=account-tab][data-tab=register]').click();await page.locator('#reg-username').fill('fcm_fixture');await page.locator('#reg-password').fill('test-'+randomUUID());await page.locator('[name=terms]').check();await page.locator('#login-form [type=submit]').click();await page.locator('#search-form').waitFor();
 await page.goto(app.base+'/#/profile');await page.locator('[data-v3-action=push-enable]:enabled').waitFor();await page.locator('[data-v3-action=push-enable]').click();await page.getByText('Уведомления включены для этого устройства.',{exact:true}).waitFor();
 assert.equal(subscriptions.length,1);assert.equal(subscriptions[0].provider,'fcm');
 assert.deepEqual(await page.evaluate(()=>window.__fcm.options.config),config.androidClientConfig);
 assert.equal(await page.evaluate(()=>window.__fcm.active.userId),await page.evaluate(()=>db.currentUserId));
 // A denied permission is not an excuse to switch provider and ask again.
 await page.evaluate(()=>{window.__fcm.options=null;Capacitor.Plugins.PoPutiRuStorePush.register=async()=>{throw Object.assign(Error('Уведомления не разрешены'),{code:'PERMISSION_DENIED'})}});
 await page.locator('[data-v3-action=push-enable]').click();await page.getByText('Уведомления не разрешены',{exact:true}).waitFor();
 assert.equal(subscriptions.length,1);assert.equal(await page.evaluate(()=>window.__fcm.options),null);
 await page.locator('[data-v3-action=push-disable]').click();await page.getByText('Уведомления отключены на этом устройстве.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__fcm.active),null);
 assert.deepEqual(errors,[]);console.log('PASS: runtime public Firebase options, RuStore-unavailable fallback, session-bound FCM activation, permission denial without fallback, logout cleanup (isolated provider fixture)');await context.close();
}finally{await browser?.close();await app.stop()}

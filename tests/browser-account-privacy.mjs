import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {chromium,webkit} from 'playwright';
import {isolatedServer} from './helpers/server.mjs';
const app=await isolatedServer({APP_ORIGINS:'https://localhost'});let browser,db;
try{
 const engine=process.env.BROWSER_ENGINE||'chromium';browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}:{})});
 db=new DatabaseSync(app.dir+'/po-puti.sqlite');const errors=[];
 for(const native of [false,true]){
  const context=await browser.newContext();
  if(native)await context.addInitScript(base=>{window.PO_PUTI_API_BASE=base;window.__secureToken='';window.Capacitor={getPlatform:()=> 'android',Plugins:{PoPutiFeatures:{getToken:async()=>({token:window.__secureToken}),setToken:async x=>{window.__secureToken=x.token},removeToken:async()=>{window.__secureToken=''},closeSearch:async()=>{},addListener:async()=>{}},PushNotifications:{addListener:async()=>{},removeAllDeliveredNotifications:async()=>{}}}}},app.base);
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(app.base);
  const username='privacy_'+(native?'native':'pwa'),password='test-'+randomUUID();await page.locator('[data-action=account-tab][data-tab=register]').click();await page.locator('#reg-username').fill(username);await page.locator('#reg-password').fill(password);await page.locator('[name=terms]').check();await page.locator('#login-form [type=submit]').click();await page.locator('#search-form').waitFor();
  await page.goto(app.base+'/#/profile');await page.evaluate(()=>{safeStorage.setItem(consentStorageKey(),'true');safeStorage.setItem('po-puti-ui-v2',JSON.stringify({search:{from:'private-address-fixture',to:'private-destination',date:'2030-01-01'}}))});await page.locator('[data-request-deletion]').click();assert.equal(db.prepare('SELECT COUNT(*) n FROM account_deletions').get().n,Number(native));
  const form=page.locator('#account-delete-form');await form.locator('[name=password]').fill(password);await form.locator('[name=confirmed]').check();await form.locator('[type=submit]').click();await page.getByText('Аккаунт удалён',{exact:true}).waitFor();assert.equal(db.prepare('SELECT COUNT(*) n FROM account_deletions').get().n,Number(native)+1);
  if(native)assert.equal(await page.evaluate(()=>window.__secureToken),'');else assert(!(await context.cookies()).some(c=>c.name==='poputi_session_v3'&&c.value));
  assert(!(await page.evaluate(()=>JSON.stringify({...localStorage}))).includes('private-address-fixture'),'deleted account search history must not remain on this device');
  await page.reload();await page.locator('#login-form').waitFor();await context.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: actual PWA and native-bridge self-service erasure, password/checkbox confirmation, cookie and Keystore bridge clearing, reload remains logged out');
}finally{db?.close();await browser?.close();await app.stop()}

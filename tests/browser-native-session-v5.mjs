import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium,webkit} from 'playwright';
import {isolatedServer} from './helpers/server.mjs';
const app=await isolatedServer({APP_ORIGINS:'https://localhost'});let browser;
try{
 const response=await fetch(app.base+'/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'native_resume',password:'test-'+randomUUID()})}),user=await response.json();assert.equal(response.status,200);
 const engine=process.env.BROWSER_ENGINE||'chromium';browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(({base,token})=>{
  let vault=token;window.__nativeClosed=0;window.__nativeListeners={};window.PO_PUTI_API_BASE=base;
  const features={getToken:async()=>({token:vault}),setToken:async v=>{vault=v.token},removeToken:async()=>{vault=''},closeSearch:async()=>{window.__nativeClosed++},showSearch:async p=>{window.__nativePayload=p},addListener:async(name,callback)=>{window.__nativeListeners[name]=callback;return {remove:async()=>{}}}};
  window.Capacitor={getPlatform:()=> 'android',isPluginAvailable:n=>n==='PoPutiFeatures'||n==='PushNotifications',Plugins:{PoPutiFeatures:features,PushNotifications:{addListener:async()=>({remove:async()=>{}}),removeAllDeliveredNotifications:async()=>{},unregister:async()=>{}}}};
 },{base:app.base,token:user.token});
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.base);
 await page.waitForURL('**/#/search');await page.locator('#search-form').waitFor();await page.waitForFunction(()=>!!window.__nativePayload);
 assert.equal(await page.evaluate(()=>localStorage.getItem('po-puti-access-v2')),null,'returning native session stays out of localStorage');
 await page.evaluate(()=>{db.search={from:'Уфа',to:'Казань',date:'2030-11-20',fromCode:'c172',toCode:'c43'};window.__nativeListeners.filter({from:'Уфа',to:'Казань',date:'2030-11-20',filter:'private'});});
 assert.deepEqual(await page.evaluate(()=>({fromCode:db.search.fromCode,toCode:db.search.toCode,date:db.search.date})),{fromCode:'c172',toCode:'c43',date:'2030-11-20'},'filter preserves chosen stations and day');
 await page.evaluate(()=>window.__nativeListeners.filter({from:'Москва',to:'Казань',date:'2030-11-20',filter:'all'}));
 assert.deepEqual(await page.evaluate(()=>({fromCode:db.search.fromCode||null,toCode:db.search.toCode})),{fromCode:null,toCode:'c43'},'editing one city clears only its stale station code');

 await page.goto(app.base+'/#/profile');await page.locator('[data-request-deletion]').waitFor();assert.equal(await page.locator('a[href$="/privacy.html"]').first().getAttribute('href'),app.base+'/privacy.html','native privacy policy must use the reachable server URL');await page.locator('[data-action=logout]').click();await page.locator('[data-action=logout-confirm]').click();await page.waitForURL('**/#/login');
 assert(await page.evaluate(()=>window.__nativeClosed>0),'logout closes native data overlay');
 assert.equal((await fetch(app.base+'/api/state',{headers:{Authorization:'Bearer '+user.token}})).status,401,'logout revokes the actual shared API session');
 assert.deepEqual(errors,[]);console.log('PASS: returning Keystore-backed client enters search, keeps localStorage empty, exposes privacy controls and closes native overlay on logout');
}finally{await browser?.close();await app.stop()}

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
  let vault=token;window.__nativeClosed=0;window.PO_PUTI_API_BASE=base;
  const features={getToken:async()=>({token:vault}),setToken:async v=>{vault=v.token},removeToken:async()=>{vault=''},closeSearch:async()=>{window.__nativeClosed++},showSearch:async p=>{window.__nativePayload=p},addListener:async()=>({remove:async()=>{}})};
  window.Capacitor={getPlatform:()=> 'android',isPluginAvailable:n=>n==='PoPutiFeatures'||n==='PushNotifications',Plugins:{PoPutiFeatures:features,PushNotifications:{addListener:async()=>({remove:async()=>{}}),removeAllDeliveredNotifications:async()=>{},unregister:async()=>{}}}};
 },{base:app.base,token:user.token});
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.base);
 await page.waitForURL('**/#/search');await page.locator('#search-form').waitFor();await page.waitForFunction(()=>!!window.__nativePayload);
 assert.equal(await page.evaluate(()=>localStorage.getItem('po-puti-access-v2')),null,'returning native session stays out of localStorage');
 await page.goto(app.base+'/#/profile');await page.locator('[data-request-deletion]').waitFor();await page.locator('[data-action=logout]').click();await page.locator('[data-action=logout-confirm]').click();await page.waitForURL('**/#/login');
 assert(await page.evaluate(()=>window.__nativeClosed>0),'logout closes native data overlay');
 assert.equal((await fetch(app.base+'/api/state',{headers:{Authorization:'Bearer '+user.token}})).status,401,'logout revokes the actual shared API session');
 assert.deepEqual(errors,[]);console.log('PASS: returning Keystore-backed client enters search, keeps localStorage empty, exposes privacy controls and closes native overlay on logout');
}finally{await browser?.close();await app.stop()}

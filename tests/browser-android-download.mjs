import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {isolatedServer} from './helpers/server.mjs';
import {roadFixture} from './helpers/road.mjs';

const apkUrl='https://vputipoputka.ru/downloads/po-puti.apk',storeUrl='https://www.rustore.ru/catalog/app/ru.poputi.app';
const androidUA='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const road=await roadFixture(),app=await isolatedServer({...road.env,ANDROID_DOWNLOAD_URL:apkUrl});
let browser;
const errors=[];
try{
 const engine=process.env.BROWSER_ENGINE||'chromium';browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}:{})});
 async function open({ua=androidUA,mode='',native=false,standalone=false,blockedStorage=false,downloadUrl=apkUrl,path='/',platform='',referrer=''}={}){
  const context=await browser.newContext({userAgent:ua,viewport:{width:390,height:844}});
  await context.addInitScript(options=>{
   if(options.native)window.Capacitor={getPlatform:()=> 'android',registerPlugin:()=>({addListener:async()=>{},removeAllDeliveredNotifications:async()=>{}})};
   if(options.mode){const original=window.matchMedia.bind(window);window.matchMedia=query=>query==='(display-mode: '+options.mode+')'?{matches:true,addEventListener(){}}:original(query)}
   if(options.standalone)Object.defineProperty(navigator,'standalone',{value:true});
   if(options.platform)Object.defineProperty(navigator,'userAgentData',{value:{platform:options.platform}});
   if(options.blockedStorage)Object.defineProperty(window,'sessionStorage',{get(){throw Error('storage unavailable')}});
   if(options.referrer)Object.defineProperty(document,'referrer',{value:options.referrer});
  },{mode,native,standalone,blockedStorage,platform,referrer});
  // Use only this test's isolated API, including inside the native mock.
  await context.route('**/config.js?*',route=>route.fulfill({contentType:'text/javascript',body:'window.PO_PUTI_BACKEND=true;window.PO_PUTI_API_BASE="";'}));
  let downloads=0,publicRequests=0;
  await context.route(apkUrl,route=>{downloads++;return route.fulfill({contentType:'application/vnd.android.package-archive',headers:{'content-disposition':'attachment; filename="po-puti.apk"'},body:Buffer.from('isolated download fixture')})});
  await context.route('**/api/public-config',async route=>{publicRequests++;const response=await route.fetch(),config=await response.json();return route.fulfill({response,json:{...config,androidDownloadUrl:downloadUrl}})});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.base+path);await page.locator('#login-form').waitFor();await page.waitForFunction(()=>!document.querySelector('#boot'));
  return {context,page,downloads:()=>downloads,publicRequests:()=>publicRequests};
 }
 for(const options of [
  {ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'},
  {ua:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'},
  {ua:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'},
  {ua:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'},
  {native:true},{mode:'standalone'},{mode:'fullscreen'},{mode:'minimal-ui'},{standalone:true},{platform:'Windows'},{referrer:'android-app://ru.poputi.app'},
  {ua:'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1; wv) AppleWebKit/537.36 Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36'}
 ]){
  const state=await open(options);assert.equal(await state.page.evaluate(()=>androidBrowserDownloadEligible()),false,JSON.stringify(options));assert.equal(await state.page.locator('.android-download-banner').count(),0);assert.equal(state.downloads(),0);assert.equal(state.publicRequests(),0);await state.context.close();
 }
 for(const downloadUrl of ['', 'javascript:alert(1)','http://example.invalid/file.apk','https://user:password@example.invalid/file.apk']){
  const state=await open({downloadUrl});await state.page.evaluate(()=>syncAndroidDownload());assert.equal(await state.page.locator('.android-download-banner').count(),0);assert.equal(state.downloads(),0);await state.context.close();
 }
 for(const blockedStorage of [false,true]){
  const state=await open({blockedStorage}),{page}=state;await page.locator('.android-download-banner').waitFor();
  assert.equal(state.publicRequests(),1);assert.equal(state.downloads(),0,'opening the page must never start a download');
  const originalUrl=page.url();await page.locator('#reg-username').fill('unsaved_user');
  await page.locator('[data-android-download-close]').click();assert.equal(await page.locator('.android-download-banner').count(),0);assert.equal(await page.locator('#reg-username').inputValue(),'unsaved_user');assert.equal(page.url(),originalUrl);
  await page.evaluate(()=>render());assert.equal(await page.locator('.android-download-banner').count(),0);
  if(!blockedStorage){await page.reload();await page.locator('#login-form').waitFor();await page.waitForFunction(()=>androidDownloadState.requested);assert.equal(await page.locator('.android-download-banner').count(),0,'dismissal survives reload in the browser session')}
  await state.context.close();
 }
 const store=await open({downloadUrl:storeUrl});await store.page.locator('.android-download-link').waitFor();assert.equal(await store.page.locator('.android-download-link').getAttribute('href'),storeUrl);assert.equal(await store.page.locator('.android-download-link').getAttribute('download'),null);await store.context.close();

 async function post(path,body,token){const response=await fetch(app.base+'/api'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());return response.json()}
 const driver=await post('/register',{username:'download_driver',password:'test-'+crypto.randomUUID()});
 const points=[];for(const city of ['Москва','Тверь']){const response=await fetch(app.base+'/api/places?q='+encodeURIComponent(city),{headers:{Authorization:'Bearer '+driver.token}});assert.equal(response.status,200);points.push((await response.json()).items[0])}
 const input={from:'Москва',to:'Тверь',date:new Date(Date.now()+3*86400000).toISOString().slice(0,10),time:'12:00',seats:2,price:300,car:'Lada',routePoints:points};
 const quote=await post('/routes/estimate',input,driver.token),ride=await post('/rides',{...input,routeQuoteId:quote.routeQuoteId,clientKey:crypto.randomUUID()},driver.token);
 for(const [index,path] of ['/#/ride/'+ride.id,'/ride/'+ride.id].entries()){
  const state=await open({path}),{page}=state;await page.locator('.android-download-banner').waitFor();
  await page.locator('[data-action=account-tab][data-tab=register]').click();await page.locator('#reg-username').fill('download_passenger_'+index);await page.locator('#reg-password').fill('test-'+crypto.randomUUID());await page.locator('[name=terms]').check();await page.locator('#login-form [type=submit]').click();
  await page.locator('[data-action=apply]').waitFor();assert(page.url().endsWith('#/ride/'+ride.id),'one shared link must open the requested ride after login');
  assert((await page.locator('.detail-page').textContent()).includes('Москва'));assert((await page.locator('.detail-page').textContent()).includes('Тверь'));
  const before=page.url();assert.equal(state.downloads(),0);
  const downloadPromise=page.waitForEvent('download');await page.locator('.android-download-link').click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'po-puti.apk');assert.equal(state.downloads(),1);assert.equal(page.url(),before,'downloading must preserve the trip page');
  assert.equal(await page.locator('.android-download-banner').evaluate(node=>getComputedStyle(node).position),'static');
  await page.locator('[data-action=apply]').scrollIntoViewIfNeeded();const button=await page.locator('[data-action=apply]').boundingBox(),banner=await page.locator('.android-download-banner').boundingBox();assert(banner.y+banner.height<=button.y||banner.y>=button.y+button.height,'banner must not overlap the booking button');
  await page.locator('[data-action=apply]').click();await page.locator('[data-action=apply-confirm]').waitFor();await page.locator('[data-action=apply-confirm]').click();await page.waitForFunction(()=>db.requests.some(request=>request.rideId===location.hash.split('/')[2]&&request.status==='pending'));
  // An expired session must also preserve a direct ride target through login.
  await page.evaluate(()=>api('/logout','POST',{}));await page.reload();await page.locator('#login-form').waitFor();assert.equal(await page.evaluate(()=>pendingPushPath),'/ride/'+ride.id);
  await page.evaluate(()=>{localStorage.removeItem('po-puti-cookie-session-v1');localStorage.setItem('po-puti-access-v2','expired-legacy-token')});await page.goto(app.base+'/ride/'+ride.id);await page.locator('#login-form').waitFor();assert.equal(await page.evaluate(()=>pendingPushPath),'/ride/'+ride.id,'legacy token migration failure must preserve the shared ride too');
  await state.context.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: Android browser-only dismissible banner, installed PWA/native/iOS/desktop hidden, missing/unsafe URL hidden, optional storage, RuStore URL replacement, click-only download, shared trip login and unblocked application');
}finally{await browser?.close();await app.stop();await road.stop()}

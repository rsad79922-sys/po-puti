import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {isolatedServer} from './helpers/server.mjs';
import {loopbackHttps} from './helpers/https.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';

const tls=await loopbackHttps(),app=await isolatedServer(),engine=process.env.BROWSER_ENGINE||'chromium';let browser;
tls.forwardTo(app.base);await mkdir(app.dir+'/downloads');await writeFile(app.dir+'/downloads/po-puti.apk','test APK fixture');
const android='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';
try{
 browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}:{})});
 async function open({ua=android,standalone=false,native=false,capacitorStub=false,mode='',referrer='',platform='',url=tls.base+'/downloads/po-puti.apk',offline=false}={}){
  const context=await browser.newContext({userAgent:ua,viewport:{width:360,height:780},serviceWorkers:'block',ignoreHTTPSErrors:true});
  await context.addInitScript(({standalone,native,capacitorStub,mode,referrer,platform})=>{
   if(standalone||mode){const original=window.matchMedia.bind(window);window.matchMedia=q=>q==='(display-mode: '+(mode||'standalone')+')'?{matches:true}:original(q)}
   if(native)window.Capacitor={getPlatform:()=> 'android',isNativePlatform:()=>true};
   if(capacitorStub)window.Capacitor={getPlatform:()=> 'web',isNativePlatform:()=>false};
   if(referrer)Object.defineProperty(document,'referrer',{value:referrer});
   if(platform)Object.defineProperty(navigator,'userAgentData',{value:{platform}});
  },{standalone,native,capacitorStub,mode,referrer,platform});
  const page=await context.newPage();const before=tls.downloads();let requests=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/api/public-config',route=>{requests++;return offline?route.abort():route.fulfill({json:{androidDownloadUrl:url}})});
  await page.goto(tls.base+'/install.html');
  return {context,page,errors,downloads:()=>tls.downloads()-before,requests:()=>requests};
 }
 // A scanner's referrer, an embedded browser, and an installed web app do not
 // prove that the native APK is installed. This is an explicit install page;
 // its Android download must remain available in all of these entry points.
 for(const options of [
  {referrer:'android-app://com.google.zxing.client.android'},
  {referrer:'android-app://com.sec.android.app.sbrowser',ua:android+' SamsungBrowser/27.0'},
  {referrer:'android-app://org.telegram.messenger'},
  {ua:'Mozilla/5.0 (Linux; Android 12; VOG-L29; wv) AppleWebKit/537.36 Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 HuaweiBrowser/15.0'},
  {ua:android+'; wv',referrer:'android-app://com.example.qrscanner'},
  {standalone:true},{mode:'minimal-ui'},{mode:'fullscreen'},{capacitorStub:true},
  {platform:'Linux'},
  {ua:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',platform:'Android'}
 ]){
  const state=await open(options);await state.page.locator('#apk-download').waitFor({state:'visible'});assert.equal(await state.page.locator('#android-install').isVisible(),true,JSON.stringify(options));assert.equal(state.downloads(),0,'opening a QR link never starts a download');
  assert.equal(await state.page.getByText('Приложение уже открыто в установленном режиме.',{exact:false}).count(),0);
  const pending=state.page.waitForEvent('download');await state.page.locator('#apk-download').click();const download=await pending;assert.equal(await download.failure(),null);assert.equal(await readFile(await download.path(),'utf8'),'test APK fixture');assert.equal(state.downloads(),1,JSON.stringify(options));assert(state.page.url().endsWith('/install.html'));assert.deepEqual(state.errors,[]);await state.context.close();
 }
 for(const options of [{ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'},{ua:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1'},{ua:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36'},{native:true}]){
  const state=await open(options);assert.equal(await state.page.locator('#android-install').isVisible(),false);assert.equal(state.requests(),0);assert.equal(state.downloads(),0);assert.deepEqual(state.errors,[]);await state.context.close();
 }
 for(const url of ['', 'http://bad.invalid/app.apk','javascript:alert(1)','https://user:password@bad.invalid/app.apk']){
  const state=await open({url});await state.page.getByText('Ссылка скачивания сейчас недоступна.',{exact:false}).waitFor();assert.equal(await state.page.locator('#apk-download').isVisible(),false);assert.equal(state.downloads(),0);assert.deepEqual(state.errors,[]);await state.context.close();
 }
 const failed=await open({offline:true});await failed.page.getByText('Ссылка скачивания сейчас недоступна.',{exact:false}).waitFor();assert.equal(await failed.page.getByText('Продолжить в браузере').isVisible(),true);await failed.context.close();
 const state=await open();await state.page.locator('#apk-download').waitFor({state:'visible'});assert.equal(state.downloads(),0);assert.equal(await state.page.locator('#pwa-install').isVisible(),false);
 assert(await state.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no mobile horizontal overflow');
 // Browser install prompt is held until an explicit user tap.
 await state.page.evaluate(()=>{const event=new Event('beforeinstallprompt');event.prompt=async()=>{window.__promptCalls=(window.__promptCalls||0)+1};event.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(event)});
 assert.equal(await state.page.evaluate(()=>window.__promptCalls||0),0);await state.page.locator('#pwa-install').click();assert.equal(await state.page.evaluate(()=>window.__promptCalls),1);
 const pending=state.page.waitForEvent('download');await state.page.locator('#apk-download').click();const download=await pending;assert.equal(download.suggestedFilename(),'po-puti.apk');assert.equal(await download.failure(),null);assert.equal(await readFile(await download.path(),'utf8'),'test APK fixture');assert.equal(state.downloads(),1);assert(state.page.url().endsWith('/install.html'));assert.deepEqual(state.errors,[]);await state.context.close();
 console.log('PASS: Android install/download from QR and messenger referrers, Samsung/Huawei/WebView UAs, installed PWA, desktop mode, native/iOS/desktop gating, tap-only APK/PWA installs and narrow layout');
}finally{await browser?.close();await app.stop();await tls.stop()}

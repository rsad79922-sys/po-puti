import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {isolatedServer} from './helpers/server.mjs';

const app=await isolatedServer(),engine=process.env.BROWSER_ENGINE||'chromium';let browser;
const android='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';
try{
 browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}:{})});
 async function open({ua=android,standalone=false,native=false,url='https://vputipoputka.ru/downloads/po-puti.apk',offline=false}={}){
  const context=await browser.newContext({userAgent:ua,viewport:{width:360,height:780},serviceWorkers:'block'});
  await context.addInitScript(({standalone,native})=>{if(standalone){const original=window.matchMedia.bind(window);window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true}:original(q)}if(native)window.Capacitor={getPlatform:()=> 'android'};},{standalone,native});
  const page=await context.newPage();let downloads=0,requests=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/api/public-config',route=>{requests++;return offline?route.abort():route.fulfill({json:{androidDownloadUrl:url}})});
  await context.route('https://vputipoputka.ru/downloads/*.apk',route=>{downloads++;return route.fulfill({body:'test APK fixture',headers:{'content-disposition':'attachment; filename="po-puti.apk"','content-type':'application/vnd.android.package-archive'}})});
  await page.goto(app.base+'/install.html');
  return {context,page,errors,downloads:()=>downloads,requests:()=>requests};
 }
 for(const options of [{ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'},{ua:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1'},{ua:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36'},{standalone:true},{native:true}]){
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
 const download=state.page.waitForEvent('download');await state.page.locator('#apk-download').click();assert.equal((await download).suggestedFilename(),'po-puti.apk');assert.equal(state.downloads(),1);assert(state.page.url().endsWith('/install.html'));assert.deepEqual(state.errors,[]);await state.context.close();
 console.log('PASS: install page platform gating, configured URL only, offline errors, tap-only APK/PWA installs, narrow mobile layout');
}finally{await browser?.close();await app.stop()}

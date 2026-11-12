/**
 * Exercises the *production hostname branch* of index.html in WebKit.
 * This is intentionally separate from browser-webkit.mjs, which runs against
 * localhost and therefore does NOT exercise the production settings branch.
 * Network is served from local checked-out files; production is untouched.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {webkit,devices} from 'playwright';

const root=resolve(fileURLToPath(new URL('../www/',import.meta.url)));
const origin='https://vputipoputka.ru';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png'};
let browser;
try{
 browser=await webkit.launch({headless:true});
 const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
 const requests=[];
 let failAppOnce=false;
 await context.route(origin+'/**',async route=>{
   const url=new URL(route.request().url);
   const pathname=url.pathname==='/'?'/index.html':url.pathname;
   requests.push(pathname);
   if(pathname==='/config.js'){
     await route.fulfill({status:503,contentType:'text/plain',body:'config.js deliberately unavailable'});
     return;
   }
   if(pathname==='/api/health'){
     await route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"backend":"sqlite"}'});
     return;
   }
   if(pathname==='/app.js'&&failAppOnce){
     failAppOnce=false;
     await route.fulfill({status:503,contentType:'text/plain',body:'temporary failure'});
     return;
   }
   const file=resolve(root,'.'+pathname);
   if(!file.startsWith(root+sep)){await route.fulfill({status:403,body:'Forbidden'});return}
   try{
     await route.fulfill({status:200,body:await readFile(file),contentType:mime[extname(file)]||'application/octet-stream',headers:{'cache-control':'no-store'}});
   }catch{
     await route.fulfill({status:404,body:'Not found'});
   }
 });
 const page=await context.newPage();
 page.setDefaultTimeout(20000);
 const exceptions=[];
 page.on('pageerror',error=>exceptions.push(error.message));
 async function check(label,tab=page){
   await tab.waitForSelector('#app .shell',{timeout:20000});
   await tab.waitForSelector('#login-form');
   assert.equal(await tab.locator('#boot').count(),0,label+': splash not cleared');
   assert.equal(await tab.evaluate(()=>window.PO_PUTI_BACKEND),true,label+': not in backend mode');
   assert.equal(await tab.evaluate(()=>window.PO_PUTI_API_BASE),'',label+': expected same-origin API');
   assert.equal(requests.filter(p=>p==='/config.js').length,0,label+': prod must not ask for config.js');
   assert.equal(exceptions.length,0,label+': console exceptions: '+exceptions.join(' | '));
 }
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await check('first open');
 await page.reload({waitUntil:'domcontentloaded'});
 await check('second open');
 const third=await context.newPage();
 await third.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await check('third open/new tab',third);
 await third.close();
 // A script temporarily returning 503 should show a visible diagnostic, not white.
 failAppOnce=true;
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByText('Не удалось загрузить app.js').waitFor({timeout:12000});
 assert.equal(await page.getByText('Повторить загрузку').count(),1,'expected retry control');
 await page.reload({waitUntil:'domcontentloaded'});
 await check('recovery after 503');
 const health=await page.evaluate(()=>fetch('/api/health').then(r=>r.json()));
 assert.equal(health.ok,true);
 console.log('PASS: WebKit production hostname, three opens, same-origin backend, failed asset recovery; config.js not required');
 await context.close();
}finally{
 if(browser)await browser.close();
}

/**
 * Real WebKit smoke test (iPhone-sized viewport): run with
 *   npm install --no-save playwright
 *   npx playwright install --with-deps webkit
 *   node tests/browser-webkit.mjs
 * No external API, user accounts or production database are touched.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, extname, sep} from 'node:path';
import {webkit, devices} from 'playwright';

const root=resolve(fileURLToPath(new URL('../www/',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/config.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});res.end('window.PO_PUTI_BACKEND = true;');return}
 if(pathname==='/api/health'){res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');return}
 const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!path.startsWith(root+sep)){res.writeHead(403);res.end();return}
 try{
  const body=await readFile(path);
  res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream','cache-control':'no-store'});
  res.end(body);
 }catch{res.writeHead(404);res.end('Not found')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await webkit.launch({headless:true});
 const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'allow'});
 const page=await context.newPage();
 page.setDefaultTimeout(20000);
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 async function expectLogin(label){
  await page.waitForSelector('#app .shell');
  await page.waitForSelector('#login-form');
  await page.waitForFunction(()=>getComputedStyle(document.body).fontSize==='14px',null,{timeout:15000});
  assert.equal(await page.locator('#boot').count(),0,label+': boot overlay not removed');
  assert.equal(errors.length,0,label+': unexpected browser exception: '+errors.join(' | '));
 }
 await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:20000});
 await expectLogin('first navigation');
 console.log('WebKit iPhone first navigation OK');
 await page.reload({waitUntil:'domcontentloaded',timeout:20000});
 await expectLogin('reload');
 console.log('WebKit iPhone reload OK');
 // Exercise the previously failing Service Worker scenario. Local HTTP loopback is
 // considered a secure origin in WebKit; the production bootstrap only registers on HTTPS.
 await page.evaluate(async()=>{if('serviceWorker' in navigator){await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready}});
 await page.reload({waitUntil:'domcontentloaded',timeout:20000});
 await expectLogin('reload with installed Service Worker');
 console.log('WebKit iPhone reload with service worker OK');
 await page.goto(origin+'/mobile-check.html',{waitUntil:'domcontentloaded',timeout:20000});
 assert.match(await page.locator('body').innerText(),/проверка загрузки/i);
 await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:20000});
 await expectLogin('after diagnostic navigation');
 console.log('WebKit iPhone navigation after diagnostic OK');
 // Simulate a fresh Safari tab after the first one has been used.
 const secondTab=await context.newPage();
 await secondTab.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:20000});
 await secondTab.waitForSelector('#login-form');
 assert.equal(await secondTab.locator('#boot').count(),0,'new tab should not show boot overlay');
 console.log('WebKit iPhone second-tab navigation OK');
 await secondTab.close();
 await context.close();
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}

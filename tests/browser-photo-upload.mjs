/**
 * WebKit iPhone-sized client test: selecting actual files, in-browser JPEG
 * compression, profile POST, car-photo POST and refreshed UI.
 * All network calls are intercepted; production VPS and real users untouched.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {webkit,chromium,devices} from 'playwright';

console.log('Browser engine: '+(process.env.BROWSER_ENGINE||'webkit'));
const origin='https://vputipoputka.ru';
const root=resolve(fileURLToPath(new URL('../www/',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/Scj3JwAAAABJRU5ErkJggg==','base64');
let browser;
try{
 browser=await (process.env.BROWSER_ENGINE==='chromium'?chromium:webkit).launch({headless:true,...(process.env.BROWSER_ENGINE==='chromium'?{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}: {})});
 const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
 await context.addInitScript(()=>{localStorage.setItem('po-puti-cookie-session-v1','cookie:fake-test-token')});
 const me={id:'user_1',username:'driver',name:'Тестовый водитель',phone:'',car:'Lada',photo:'',role:'user'};
 const rides=[];
 let profilePayload=null;
 let ridePayload=null;
 await context.route(origin+'/**',async route=>{
   const url=new URL(route.request().url());
   const path=url.pathname;
   const method=route.request().method();
   const json=async(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(path==='/api/state'&&method==='GET'){
     return json({currentUserId:me.id,users:[me],rides,requests:[],notifications:[],reviews:[],messages:[],reports:[]});
   }
   if(path==='/api/profile'&&method==='POST'){
     profilePayload=route.request().postDataJSON();
     Object.assign(me,profilePayload);
     return json({ok:true});
   }
   if(path==='/api/rides'&&method==='POST'){
     ridePayload=route.request().postDataJSON();
     rides.unshift({id:'ride_1',driverId:me.id,...ridePayload,photo:ridePayload.photo||'',cancelled:false});
     return json({id:'ride_1'});
   }
   if(path==='/api/health')return json({ok:true,backend:'sqlite'});
   const filename=resolve(root,'.'+(path==='/'?'/index.html':path));
   if(!filename.startsWith(root+sep))return route.fulfill({status:403,body:'Forbidden'});
   try{
     return route.fulfill({status:200,contentType:mime[extname(filename)]||'application/octet-stream',body:await readFile(filename)});
   }catch{return route.fulfill({status:404,body:'Not found'})}
 });
 const page=await context.newPage();
 page.setDefaultTimeout(20000);
 const exceptions=[];
 page.on('pageerror',error=>exceptions.push(error.message));
 await page.goto(origin+'/#/profile',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#profile-photo');
 assert.equal(await page.locator('#profile-photo').getAttribute('accept'),'image/*');
 await page.locator('#profile-photo').setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:png});
 await page.waitForFunction(()=>document.querySelector('.profile-header .avatar img')?.src.startsWith('data:image/jpeg;base64,'));
 assert(profilePayload?.photo?.startsWith('data:image/jpeg;base64,'),'iPhone avatar must be converted to JPEG and saved');
 await page.goto(origin+'/#/publish',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#publish-form');
 await page.locator('[name="from"]').fill('Ижевск');
 await page.locator('[name="to"]').fill('Казань');
 const departure=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 await page.locator('[name="date"]').fill(departure);
 await page.locator('[name="time"]').fill('12:30');
 await page.locator('[name="price"]').fill('1000');
 await page.locator('[name="car"]').fill('Lada');
 await page.locator('#pub-photo').setInputFiles({name:'car.png',mimeType:'image/png',buffer:png});
 await page.getByText('Фото готово и будет добавлено при публикации поездки.').waitFor();
 assert.equal(await page.locator('#pub-photo-preview').count(),1,'car preview must display after selection');
 await page.locator('#publish-form button[type="submit"]').click();
 await page.locator('[data-action="publish-confirm"]').click();
 await page.waitForFunction(()=>location.hash.includes('/ride/ride_1'));
 assert(ridePayload?.photo?.startsWith('data:image/jpeg;base64,'),'photo must accompany car ride API payload');
 assert.equal(rides[0].photo,ridePayload.photo,'car photo should survive round trip');
 assert.deepEqual(exceptions,[],'WebKit page errors');
 console.log('PASS: iPhone WebKit profile avatar + car photos selected, JPEG compressed, sent to API and visible on reload');
 await context.close();
}finally{if(browser)await browser.close()}

import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {chromium,webkit} from 'playwright';
import {isolatedServer} from './helpers/server.mjs';
import {roadFixture} from './helpers/road.mjs';
const road=await roadFixture(5400),app=await isolatedServer({...road.env,APP_ORIGINS:'https://localhost',YANDEX_RASP_API_KEY:'local-fixture-only',RASP_LICENSE_CONFIRMED:'true',RASP_DAILY_LIMIT:'20',RASP_CACHE_SECONDS:'3600',ADS_ENABLED:'true',ADS_TERMS_CONFIRMED:'true'});
let browser,db;
try{
 const engine=process.env.BROWSER_ENGINE||'chromium';browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}:{})});
 db=new DatabaseSync(app.dir+'/po-puti.sqlite');const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10),end=new Date(Date.parse(date)+6*86400000).toISOString().slice(0,10),expiry=Date.now()+3600000;
 for(const [code,title] of [['c100','Нефтекамск'],['c200','Уфа']])db.prepare('INSERT INTO bus_places VALUES(?,?,?,?,?,?,?,?)').run(code,title,'Башкортостан','Asia/Yekaterinburg','settlement',Date.now(),expiry,title.toLowerCase());
 const bus={type:'bus_service',id:'verified-bus-fixture',departureAt:date+'T07:00:00Z',arrivalAt:date+'T10:00:00Z',departureTimeZone:'Asia/Yekaterinburg',destinationTimeZone:'Asia/Yekaterinburg',from:'Нефтекамск',to:'Уфа',carrier:'Тестовый перевозчик',purchase:{url:'',cashier:''},source:'yandex_rasp'};
 const hash=createHash('sha256').update(JSON.stringify(['bus','c100','c200',date,0])).digest('hex');db.prepare('INSERT INTO external_cache VALUES(?,?,?)').run(hash,JSON.stringify({items:[bus],status:'ok',nextOffset:null}),expiry);
 const errors=[];
 for(const native of [false,true]){
  const context=await browser.newContext({viewport:{width:390,height:844}});if(native)await context.addInitScript(base=>{window.PO_PUTI_API_BASE=base;window.Capacitor={getPlatform:()=> 'android',registerPlugin:()=>({addListener:async()=>{},removeAllDeliveredNotifications:async()=>{}})}},app.base);
  const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto(app.base);await page.locator('[data-action=account-tab][data-tab=register]').click();await page.locator('#reg-username').fill('unified_'+(native?'android':'pwa'));await page.locator('#reg-password').fill('test-'+randomUUID());await page.locator('[name=terms]').check();await page.locator('#login-form [type=submit]').click();await page.locator('#search-form').waitFor();
  await page.locator('#search-from').fill('Нефтекамск');await page.locator('#search-to').fill('Уфа');await page.locator('#search-date').fill(date);await page.locator('#search-form [type=submit]').click();await page.locator('.bus-card').waitFor();
  const card=page.locator('.bus-card');assert((await card.innerText()).includes('Информация о покупке билета отсутствует'));for(const forbidden of ['Свободных мест','Отправить заявку','Чат','Позвонить','за место'])assert(!(await card.innerText()).includes(forbidden));assert.equal(await page.locator('[data-ad-slot]').count(),2);
  await page.locator('[data-search-filter=private]').click();assert.equal(await page.locator('.bus-card').count(),0);await page.locator('[data-search-filter=bus]').click();await card.waitFor();
  await page.goto(app.base+'/#/publish');await page.locator('#pub-from').fill('Москва');await page.locator('#pub-to').fill('Тверь');await page.locator('#pub-date').fill(date);await page.locator('#pub-time').fill('13:00');await page.locator('#pub-car').fill('Lada');await page.locator('#pub-price').fill('300');await page.locator('[name=seriesMode]').selectOption('regular');await page.locator('[name=seriesEnd]').fill(end);for(let i=0;i<7;i++)await page.locator('[name=weekdays][value="'+i+'"]').check();await page.locator('[name=privateRide]').check();
  await page.waitForFunction(()=>!!db.draft?.routeQuoteId);assert.equal(await page.locator('[name=routeWaypoints],[name=departureTimeZone],[name=destinationTimeZone],[name=estimatedDurationMinutes],[name=routeChangeReason]').count(),0);
  await page.locator('#publish-form [type=submit]').click();await page.locator('[data-action=publish-confirm]').click();await page.waitForURL('**/#/ride/*');assert.equal(db.prepare('SELECT COUNT(*) n FROM rides r JOIN users u ON u.id=r.driver_id WHERE u.username=?').get('unified_'+(native?'android':'pwa')).n,7);
  await page.goto(app.base+'/#/trips');await page.locator('[data-renew-series]').waitFor();await page.locator('[data-cancel-series]').click();await page.locator('[data-confirm-series-cancel]').click();await page.getByText('Будущие отправления отменены',{exact:true}).waitFor();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rides r JOIN users u ON u.id=r.driver_id WHERE u.username=? AND r.cancelled=0').get('unified_'+(native?'android':'pwa')).n,0);
  await context.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: PWA/native bridge unified bus search, safe cards, filters, two slots, seven-day series, simplified form and explicit series cancellation');
}finally{db?.close();await browser?.close();await app.stop();await road.stop()}

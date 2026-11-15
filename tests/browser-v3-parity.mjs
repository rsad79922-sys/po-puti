// Real shared API/UI; Android WebView bridge is simulated, not a physical-device claim.
import assert from 'node:assert/strict';import {chromium,webkit} from 'playwright';import {DatabaseSync} from 'node:sqlite';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {isolatedServer} from './helpers/server.mjs';
const app=await isolatedServer({APP_ORIGINS:'https://localhost'});let browser,db;
try{
 const engine=process.env.BROWSER_ENGINE||'chromium';browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}: {})});
 const errors=[];let publication;
 async function account(username,native=false){
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:native?'Asia/Yekaterinburg':'America/New_York'});
  if(native)await context.addInitScript(base=>{window.PO_PUTI_API_BASE=base;window.Capacitor={getPlatform:()=> 'android',registerPlugin:()=>({addListener:async()=>({remove:async()=>{}}),removeAllDeliveredNotifications:async()=>{},unregister:async()=>{}})}},app.base);
  const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://yandex.ru/**',r=>r.abort());
  page.on('request',r=>{if(r.url().endsWith('/api/rides')&&r.method()==='POST')publication=r.postDataJSON()});
  await page.goto(app.base);await page.locator('[data-action="account-tab"][data-tab="register"]').click();await page.locator('#reg-username').fill(username);await page.locator('#reg-password').fill('browser-'+randomUUID());await page.locator('[name=terms]').check();await page.locator('#login-form button[type=submit]').click();await page.locator('#search-form').waitFor();return page;
 }
 const native=await account('native_v3',true),pwa=await account('pwa_v3');
 assert(await native.evaluate(()=>!!localStorage.getItem('po-puti-access-v2')),'native client uses the shared Bearer API');
 assert.equal(await pwa.evaluate(()=>localStorage.getItem('po-puti-access-v2')),null,'PWA keeps no Bearer in localStorage');
 const nativeState=await native.evaluate(async()=>{const r=await fetch('/api/state',{headers:{Authorization:'Bearer '+localStorage.getItem('po-puti-access-v2')}});return r.json()});
 const pwaState=await pwa.evaluate(async()=>{const r=await fetch('/api/state');return r.json()});
 const driverId=nativeState.currentUserId,passengerId=pwaState.currentUserId;
 await native.goto(app.base+'/#/publish');await native.locator('#pub-from').fill('Москва');await native.locator('#pub-to').fill('Тверь');
 const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
 await native.locator('#pub-date').fill(date);await native.locator('#pub-time').fill('21:00');await native.locator('[name=departureTimeZone]').selectOption('Europe/Moscow');await native.locator('[name=estimatedDurationMinutes]').fill('120');await native.locator('#pub-price').fill('500');await native.locator('#pub-car').fill('Lada');
 await native.locator('#publish-form [type=submit]').click();await native.locator('[data-action=publish-confirm]').click();await native.waitForURL('**/#/ride/*');
 const rideId=new URL(native.url()).hash.split('/').at(-1);assert.equal(publication.departureTimeZone,'Europe/Moscow');assert.equal(publication.estimatedDurationMinutes,120);
 await pwa.reload();await pwa.locator('#search-from').fill('Москва');await pwa.locator('#search-to').fill('Тверь');await pwa.locator('#search-date').fill(date);await pwa.locator('#search-form [type=submit]').click();await pwa.locator('.trip-card').click();await pwa.locator('[data-action=apply]').click();await pwa.locator('[data-action=apply-confirm]').click();await pwa.locator('.pill.pending').waitFor();
 await native.goto(app.base+'/#/trips');await native.reload();await native.locator('[data-action=accept-request]').click();await native.locator('[data-action=open-chat]').waitFor();
 db=new DatabaseSync(app.dir+'/po-puti.sqlite');db.prepare('UPDATE rides SET departure_at=?,estimated_arrival_at=? WHERE id=?').run(Date.now()-3*3600000,Date.now()-2*3600000,rideId);
 await native.reload();await native.locator('[data-action=tab][data-tab=past]').click();await native.locator('[data-v3-action=yes]').waitFor();
 assert.equal(await native.locator('[data-action=accept-request],[data-action=reject-request],[data-action=cancel-ride]').count(),0,'native archived trip has no participant-edit controls');
 await native.locator('[data-v3-action=yes]').click();await native.locator('#v3-review-form').waitFor({timeout:5000});await native.locator('#dialog-overlay [data-action=modal-close]').first().click();
 await pwa.reload();await pwa.locator('[data-v3-action=yes]').click();await pwa.locator('#v3-review-form').waitFor({timeout:5000});
 await pwa.getByText('После отправки изменить или удалить отзыв будет невозможно. Опубликуем его через 7 дней',{exact:true}).waitFor();
 await pwa.locator('#v3-review-form [name=score]').selectOption('2');await pwa.locator('#v3-review-form [name=body]').fill('Черновик можно исправить');await pwa.locator('#v3-review-form [name=score]').selectOption('4');await pwa.locator('#v3-review-form [name=body]').fill('Скрытый отзыв PWA для Android');await pwa.locator('#v3-review-form [type=submit]').click();
 await pwa.getByText('Отзыв сохранён. Он станет доступен другим пользователям через 7 дней',{exact:true}).waitFor();
 await pwa.goto(app.base+'/#/my-reviews');await pwa.getByText('Скрытый отзыв PWA для Android',{exact:false}).waitFor();assert.equal(await pwa.locator('[name=body]').count(),0,'sent review is read-only');
 await native.reload();assert(!(await native.locator('body').innerText()).includes('Скрытый отзыв PWA для Android'),'recipient must not see a private PWA review');
 await native.goto(app.base+'/#/profile');await native.getByText('Неотправленных отзывов: 1.',{exact:false}).waitFor();
 await native.locator('[data-action=nav][data-route="/my-reviews"]').click();await native.locator('[data-v3-action=review]').click();await native.locator('#v3-review-form').waitFor();await native.locator('#dialog-overlay [data-action=modal-close]').first().click();
 const second=randomUUID(),dep=Date.now()-4*3600000;db.prepare('INSERT INTO rides(id,driver_id,origin,destination,date,time,seats,car,created,departure_at,estimated_duration_minutes,estimated_arrival_at,eta_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(second,driverId,'Москва','Казань',new Date(dep).toISOString().slice(0,10),'12:00',1,'Lada',Date.now(),dep,60,dep+3600000,'driver_manual');db.prepare('INSERT INTO requests(id,ride_id,user_id,status,created) VALUES(?,?,?,?,?)').run(randomUUID(),second,passengerId,'accepted',Date.now());
 await pwa.goto(app.base+'/#/ride/'+second);await pwa.reload();await pwa.locator('[data-v3-action=no]').click();await pwa.locator('#v3-no-form [name=reason]').fill('Не поехал');await pwa.locator('#v3-no-form [type=submit]').click();await pwa.locator('#v3-no-form').waitFor({state:'detached'});assert.equal(await pwa.locator('#v3-review-form').count(),0,'No must not open a rating form');
 // Adaptive admin UI reads live data and moderates visibility without changing content.
 const moderator=await account('admin_v3');const adminId=await moderator.evaluate(async()=>{const r=await fetch('/api/state');return (await r.json()).currentUserId});
 const promoted=spawnSync(process.execPath,['scripts/admin-user.mjs','--user-id',adminId,'--reason','Browser fixture owner'],{env:{...process.env,DATA_DIR:app.dir},encoding:'utf8'});assert.equal(promoted.status,0,promoted.stderr);
 await moderator.goto(app.base+'/admin');await moderator.getByRole('heading',{name:'Кабинет администратора',exact:true}).waitFor();
 await moderator.locator('[data-v3-action=admin-section][data-section=reviews]').click();await moderator.locator('.admin-json').filter({hasText:'Скрытый отзыв PWA для Android'}).waitFor();
 const reviewId=db.prepare('SELECT id FROM pair_reviews WHERE ride_id=?').get(rideId).id;
 await moderator.locator('[data-v3-action=admin-operation][data-id="'+reviewId+'"]').click();assert.equal(await moderator.locator('#v3-admin-operation [name=score],#v3-admin-operation [name=body]').count(),0);
 await moderator.locator('#v3-admin-operation [name=reason]').fill('Проверка модерации');await moderator.locator('#v3-admin-operation [type=submit]').click();await moderator.locator('#v3-admin-operation').waitFor({state:'detached'});
 assert.equal(db.prepare('SELECT moderation_status FROM pair_reviews WHERE id=?').get(reviewId).moderation_status,'blocked');assert.equal(db.prepare('SELECT score FROM pair_reviews WHERE id=?').get(reviewId).score,4);
 await moderator.locator('[data-v3-action=admin-section][data-section=audit]').click();await moderator.locator('.admin-json').filter({hasText:'Проверка модерации'}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS ('+engine+'): shared native-bridge/PWA UI and DB, explicit timezone/ETA, post-departure archive, immediate Yes review, No reason/no rating, immutable hidden review, reminder and real admin moderation/audit');
}finally{if(db)db.close();if(browser)await browser.close();await app.stop()}

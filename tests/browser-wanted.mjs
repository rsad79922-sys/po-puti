import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {chromium,webkit} from 'playwright';
import {isolatedServer} from './helpers/server.mjs';
const app=await isolatedServer({APP_ORIGINS:'https://localhost'});let browser,sql;
try{
 const engine=process.env.BROWSER_ENGINE||'chromium';browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']}:{})});sql=new DatabaseSync(app.dir+'/po-puti.sqlite');
 for(const native of [false,true]){
  const context=await browser.newContext({viewport:{width:360,height:800}});if(native)await context.addInitScript(()=>{window.Capacitor={getPlatform:()=> 'android',registerPlugin:()=>({addListener:async()=>{},removeAllDeliveredNotifications:async()=>{}})}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto(app.base);await page.locator('[data-tab=register]').click();await page.locator('#reg-username').fill('wanted_'+randomUUID().slice(0,8));await page.locator('#reg-password').fill(randomUUID());await page.locator('[name=terms]').check();await page.locator('#login-form [type=submit]').click();await page.locator('[data-wanted-nav=wanted-new]').waitFor();
  await page.locator('#search-from').fill('Уфа');await page.locator('#search-to').fill('Казань');const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);await page.locator('#search-date').fill(date);
  for(const filter of ['bus','private','all']){await page.locator('[data-search-filter='+filter+']').click();assert.equal(await page.locator('#search-from').inputValue(),'Уфа');assert.equal(await page.locator('#search-date').inputValue(),date)}
  await page.locator('[data-wanted-nav=wanted-new]').click();await page.locator('#wanted-form [name=from]').fill('Уфа');await page.locator('#wanted-form [name=to]').fill('Казань');await page.locator('#wanted-form [name=date]').fill(date);await page.locator('#wanted-form [name=time]').fill('12:00');await page.locator('#wanted-form [name=comment]').fill('test@example.org');await page.locator('#wanted-form [type=submit]').click();await page.locator('[data-wanted-error]').filter({hasText:'контакт'}).waitFor();
  await page.locator('#wanted-form [name=comment]').fill('Один чемодан');await page.locator('#wanted-form [type=submit]').click();await page.locator('[data-wanted-cancel]').first().waitFor();await page.locator('[data-wanted-cancel]').first().click();await page.getByText('Отменена',{exact:true}).first().waitFor();
  const id=await page.evaluate(()=>db.currentUserId);sql.prepare("UPDATE users SET role='admin' WHERE id=?").run(id);await page.evaluate(async()=>{await refreshRemote({fresh:true});navigate('/admin')});await page.locator('[data-wanted-toggle]').waitFor();await page.locator('[data-wanted-toggle]').click();await page.waitForFunction(()=>wantedState.enabled===false);await page.evaluate(()=>navigate('/wanted-new'));assert.equal(await page.locator('#wanted-form').count(),0);
  await page.evaluate(()=>navigate('/admin'));await page.locator('[data-wanted-toggle]').click();await page.waitForFunction(()=>wantedState.enabled===true);await page.evaluate(()=>navigate('/wanted'));await page.getByText('Отменена',{exact:true}).first().waitFor();assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS: mobile PWA/Android bridge three filters preserve query, passenger publication/error/cancellation and admin disable/restore without data loss');
}finally{sql?.close();await browser?.close();await app.stop()}

// Real browser + real isolated API. Never writes to the production server.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,webkit} from 'playwright';

const dir=await mkdtemp(join(tmpdir(),'po-puti-browser-'));
const port=20000+Math.floor(Math.random()*30000);
const origin='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server/server.mjs'],{
 env:{...process.env,DATA_DIR:dir,HOST:'127.0.0.1',PORT:String(port),APP_ORIGINS:origin,ADMIN_USERNAME:'',ADMIN_PASSWORD:''},
 stdio:['ignore','pipe','pipe']
});
let browser,output='';
server.stderr.on('data',chunk=>output+=chunk);
const errors=[];
try{
 let ready=false;
 for(let i=0;i<80;i++){
  if(server.exitCode!==null)throw Error(output);
  try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 assert(ready,'test server failed');
 const engine=process.env.BROWSER_ENGINE||'chromium';
 browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}: {})});
 async function account(username){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('https://yandex.ru/**',route=>route.abort());
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);
  await page.locator('[data-action="account-tab"][data-tab="register"]').click();
  await page.locator('#reg-username').fill(username);
  await page.locator('#reg-password').fill('browser-test-password');
  await page.locator('[name="terms"]').check();
  await page.locator('#login-form button[type="submit"]').click();
  await page.waitForSelector('#search-form');
  return page;
 }
 const driver=await account('browser_driver');
 const passenger=await account('browser_passenger');
 await driver.goto(origin+'/profile');
 await driver.locator('#profile-form').waitFor();
 assert.equal(new URL(driver.url()).hash,'#/profile','direct path must select the requested screen');
 await driver.goto(origin+'/#/publish');
 await driver.locator('#pub-from').fill('Москва');
 await driver.locator('#pub-to').fill('Санкт-Петербург');
 await driver.locator('#pub-seats').selectOption('1');
 await driver.locator('#pub-price').fill('900');
 await driver.locator('#pub-car').fill('Lada');
 await driver.locator('#publish-form button[type="submit"]').click();
 await driver.locator('[data-action="publish-confirm"]').click();
 await driver.waitForURL('**/#/ride/*');
 const rideUrl=driver.url();
 await passenger.reload();
 await passenger.locator('.trip-card').click();
 assert.equal(passenger.url(),rideUrl);
 await passenger.locator('[data-action="apply"]').click();
 await passenger.locator('[data-action="apply-confirm"]').click();
 await passenger.locator('.pill.pending').waitFor();
 await driver.goto(origin+'/#/trips');await driver.reload();
 await driver.locator('[data-action="accept-request"]').click();
 await driver.locator('[data-action="open-chat"]').waitFor();
 await passenger.reload();
 await passenger.locator('[data-action="open-chat"]').click();
 await passenger.locator('#message-form [name="text"]').fill('Здравствуйте, буду вовремя');
 await passenger.locator('#message-form button').click();
 await passenger.locator('.bubble').filter({hasText:'Здравствуйте, буду вовремя'}).waitFor();
 await driver.locator('[data-action="open-chat"]').click();
 await driver.reload();
 await driver.locator('.bubble').filter({hasText:'Здравствуйте, буду вовремя'}).waitFor();
 await driver.goto(rideUrl);
 await driver.locator('[data-action="cancel-ride"]').click();
 await driver.locator('[data-action="cancel-confirm"]').click();
 await driver.getByText('Поездка отменена водителем.').waitFor();
 await passenger.reload();
 await passenger.getByText('Переписка недоступна').waitFor();
 await passenger.goto(origin+'/#/profile');
 await passenger.locator('[data-action="logout"]').click();
 await passenger.locator('[data-action="logout-confirm"]').click();
 await passenger.locator('#login-form').waitFor();
 await passenger.goto(origin+'/#/trips');
 await passenger.getByText('Нужно войти',{exact:true}).waitFor();
 assert.deepEqual(errors,[],'browser runtime errors');
 console.log('PASS ('+engine+'): registration → publication → search → request → acceptance → chat → cancellation → logout');
}finally{
 if(browser)await browser.close();
 server.kill('SIGTERM');
 await new Promise(resolve=>{if(server.exitCode!==null||server.signalCode!==null)return resolve();server.once('exit',resolve)});
 await rm(dir,{recursive:true,force:true});
}

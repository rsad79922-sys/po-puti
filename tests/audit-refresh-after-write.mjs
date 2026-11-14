import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../www/app.js',import.meta.url),'utf8');
let serverName='Старое имя',snapshotNumber=0,profiles=0;
const pending=[];
const listeners={};
const store=new Map([['po-puti-access-v2','token1']]);
const root={innerHTML:''};
const window={PO_PUTI_BACKEND:true,PO_PUTI_API_BASE:'https://example.test',addEventListener:(name,callback)=>listeners[name]=callback};
const context={
 window,location:{hash:'#/profile',protocol:'https:'},history:{length:1},
 navigator:{onLine:true},scrollTo(){},
 document:{
  visibilityState:'visible',activeElement:{tagName:'BODY'},
  querySelector:selector=>selector==='#app'?root:null,
  addEventListener(){},
 },
 localStorage:{getItem:key=>store.get(key)||null,setItem:(key,v)=>store.set(key,v),removeItem:key=>store.delete(key)},
 fetch:(url,opts)=>{
  if(String(url).endsWith('/api/state')){
   snapshotNumber++;
   const nameAtRequest=serverName;
   const tokenAtRequest=String(opts.headers.Authorization||'');
   return new Promise(resolve=>pending.push(()=>resolve({ok:true,status:200,json:async()=>({
    currentUserId:'me',users:[{id:'me',name:nameAtRequest,phone:'',username:'test',role:'user',photo:''}],
    rides:[],requests:[],notifications:[],reviews:[],messages:[],reports:[],tokenAtRequest
   })})));
  }
  if(String(url).endsWith('/api/profile')){
   profiles++;
   serverName=JSON.parse(opts.body).name;
   return Promise.resolve({ok:true,status:200,json:async()=>({ok:true})});
  }
  throw Error('unexpected URL '+url);
 },
 setInterval(){return 1},setTimeout(){return 1},clearTimeout(){},console,
 Date,JSON,Math,String,Number,URL,Intl,AbortController,TextEncoder,crypto:globalThis.crypto
};
vm.runInNewContext(app+'\ntoast=()=>{};window.__refresh=refreshRemote;window.__mutate=mutateRemote;window.__name=()=>db.users[0]?.name;window.__setToken=v=>{accessToken=v};window.__logout=clearRemoteSession;window.__state=()=>db;window.__photo=photoUrl;window.__seats=seatsLeft;',context,{timeout:2500,filename:'app.js'});
const ticks=async()=>{await Promise.resolve();await Promise.resolve();await new Promise(r=>setImmediate(r));};
assert.equal(pending.length,1,'initial state call');
const startup=window.__refresh();
pending.shift()();await startup;await ticks();
assert.equal(window.__name(),'Старое имя');
const earlier=window.__refresh(); // stale snapshot begins
assert.equal(pending.length,1);
const save=window.__mutate('/profile',{name:'Новое имя'},'Сохранено');
await ticks();
assert.equal(profiles,1);
assert.equal(pending.length,1,'mutation must wait for the older snapshot');
pending.shift()();await earlier;await ticks();
assert.equal(pending.length,1,'mutation must request fresh /state after old poll');
pending.shift()();await save;await ticks();
assert.equal(window.__name(),'Новое имя','old in-flight snapshot must not hide a confirmed write');
const pendingOld=window.__refresh();
window.__setToken('token2');
const pendingNew=window.__refresh({fresh:true});
assert.equal(pending.length,1,'stale session request must be awaited before new session request');
pending.shift()();
await pendingOld;await ticks();
assert.equal(pending.length,1,'new session must make its own request');
pending.shift()();await pendingNew;await ticks();
assert.equal(window.__name(),'Новое имя');
console.log('PASS: committed changes force fresh state; old session cannot overwrite new session');

assert.equal(window.__seats({id:'other',seats:2,occupiedSeats:2}),0,'public availability must use server totals');
assert.equal(window.__photo('/uploads/test.jpg'),'https://example.test/uploads/test.jpg','native photos must use API origin');
window.__logout();
assert.equal(window.__state().users.length,0,'logout retained previous profiles');
assert.equal(window.__state().messages.length,0);
assert.equal(window.__state().draft,null);
assert.equal(store.has('po-puti-access-v2'),false);
console.log('PASS: server occupancy and logout data clearing');

listeners.storage({key:'po-puti-prototype-v2',newValue:JSON.stringify({currentUserId:'demo',users:[{id:'demo',name:'Demo'}],rides:[]})});
assert.equal(window.__state().currentUserId,null,'demo tab must not overwrite remote state');

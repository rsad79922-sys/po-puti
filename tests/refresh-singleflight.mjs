import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../www/app.js',import.meta.url),'utf8');
const noop=()=>{};
const waiters=[];
let requests=0;
const listeners=new Map();
let poll;
const stubData={currentUserId:'test-user',users:[{id:'test-user',name:'Test',phone:''}],rides:[],requests:[],notifications:[],reviews:[],messages:[],reports:[]};
const window={PO_PUTI_BACKEND:true,PO_PUTI_API_BASE:'',addEventListener:(event,fn)=>listeners.set(event,fn)};
const root={innerHTML:''};
const store=new Map([['po-puti-cookie-session-v1','cookie:token-for-test']]);
const context={
 window,location:{hash:'#/login',protocol:'https:'},
 navigator:{onLine:true},
 document:{querySelector:id=>id==='#app'?root:null,addEventListener:noop,visibilityState:'visible',activeElement:{tagName:'BODY'}},
 localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
 fetch:url=>{
  assert(String(url).endsWith('/api/state'),'unexpected endpoint: '+url);
  requests++;
  return new Promise(resolve=>waiters.push(()=>resolve({ok:true,status:200,json:async()=>stubData})));
 },
 setInterval:(fn,ms)=>{assert.equal(ms,45000,'do not aggressively poll photos and full state');poll=fn;return 1},
 setTimeout:noop,clearTimeout:noop,scrollTo:noop,
 console,Date,JSON,String,Number,Math,URL,Intl,AbortController,TextEncoder,crypto:globalThis.crypto
};
vm.runInNewContext(source+'\nwindow.__refresh=refreshRemote;',context,{timeout:2000,filename:'app.js'});
assert.equal(requests,1,'startup should make exactly one state request');
const multiple=[window.__refresh(),window.__refresh(),window.__refresh()];
assert.equal(requests,1,'concurrent focus/mutation/poll must share a state request');
waiters.shift()();
await Promise.all(multiple);
assert.equal(root.innerHTML.length>0,true,'app should still render after refresh');
listeners.get('focus')();
assert.equal(requests,1,'focus shortly after successful refresh must not refetch');
poll();
assert.equal(requests,2,'background poll should start only one new refresh');
poll();listeners.get('focus')();
assert.equal(requests,2,'focus/poll must not overlap a pending poll');
waiters.shift()();
await Promise.resolve();
await Promise.resolve();
await new Promise(resolve=>setImmediate(resolve));
const next=window.__refresh();
assert.equal(requests,3,'refresh should become available after previous request completes');
waiters.shift()();
await next;
console.log('PASS: safari startup, focus, timer and mutation share one request; background poll is 45s');

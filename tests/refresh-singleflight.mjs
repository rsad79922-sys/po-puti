import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../www/app.js',import.meta.url),'utf8');
const noop=()=>{};
let calls=0;
const waiters=[];
const stubData={currentUserId:null,users:[],rides:[],requests:[],notifications:[],reviews:[],messages:[],reports:[]};
const root={innerHTML:''};
const window={PO_PUTI_BACKEND:true,PO_PUTI_API_BASE:'',addEventListener:noop};
const store=new Map([['po-puti-access-v2','token-example']]);
const context={
 window,location:{hash:'#/login',protocol:'https:'},
 navigator:{onLine:true},
 document:{querySelector:id=>id==='#app'?root:null,addEventListener:noop,visibilityState:'visible',activeElement:{tagName:'BODY'}},
 localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
 fetch:()=>{
   calls++;
   return new Promise(resolve=>waiters.push(()=>resolve({ok:true,status:200,json:async()=>stubData})));
 },
 setInterval:noop,setTimeout:noop,clearTimeout:noop,scrollTo:noop,
 console,Date,JSON,String,Number,Math,URL,Intl,AbortController,TextEncoder,
 crypto:globalThis.crypto
};
vm.runInNewContext(app+'\nwindow.__refresh=refreshRemote;',context,{timeout:2000,filename:'app.js'});
assert.equal(calls,1,'startup should issue one initial state request');
const pending=[window.__refresh(),window.__refresh(),window.__refresh()];
assert.equal(calls,1,'focus/timer must not cause concurrent full-state downloads');
waiters.shift()();
await Promise.all(pending);
const next=window.__refresh();
assert.equal(calls,2,'after completion next refresh should work');
waiters.shift()();
await next;
console.log('PASS: consecutive Safari focus and polling events share one state request');

/**
 * Reproduce a real Safari state race: a POST completes while an older
 * /state GET remains in flight. No real account, server, or database is used.
 */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../www/app.js',import.meta.url),'utf8');
const oldState={currentUserId:'u',users:[{id:'u',username:'driver',name:'Before',role:'user',phone:'',car:'Lada',photo:''}],rides:[],requests:[],notifications:[],reviews:[],messages:[],reports:[]};
const newState={...oldState,users:[{...oldState.users[0],name:'After'}]};
const stateResolvers=[];
let calls=0,postCalls=0;
const noop=()=>{};
const root={innerHTML:''};
const storage=new Map([['po-puti-access-v2','session']]);
const listeners=new Map();
const document={
 querySelector(sel){return sel==='#app'?root:null},
 createElement(){return {className:'',textContent:'',style:{},remove:noop}},
 body:{appendChild:noop},
 addEventListener:noop,
 visibilityState:'visible',
 activeElement:{tagName:'BODY'}
};
const window={PO_PUTI_BACKEND:true,PO_PUTI_API_BASE:'',addEventListener:(key,fn)=>listeners.set(key,fn)};
const response=data=>({ok:true,status:200,json:async()=>data});
const fetch=(url,init)=>{
 if(url==='/api/state'){
  calls++;
  return new Promise(resolve=>stateResolvers.push(resolve));
 }
 if(url==='/api/profile'&&init.method==='POST'){
  postCalls++;
  return Promise.resolve(response({ok:true}));
 }
 throw Error('Unexpected request '+url);
};
const context={
 window,document,location:{hash:'#/profile',protocol:'https:'},
 navigator:{onLine:true},localStorage:{
  getItem:k=>storage.get(k)||null,
  setItem:(k,v)=>storage.set(k,v),
  removeItem:k=>storage.delete(k)
 },fetch,console,Date,JSON,String,Number,Math,URL,Intl,
 AbortController,TextEncoder,crypto:globalThis.crypto,
 setTimeout:noop,clearTimeout:noop,setInterval:noop,scrollTo:noop
};
vm.runInNewContext(source+'\nwindow.__mutate=mutateRemote;window.__refresh=refreshRemote;window.__getState=()=>db;',context,{timeout:2500,filename:'app.js'});
assert.equal(calls,1,'startup must issue only one GET /state');
const task=window.__mutate('/profile',{name:'After',car:'Lada',phone:''},'Профиль сохранён');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(postCalls,1,'POST must happen even if a GET is in progress');
assert.equal(calls,1,'POST must not race an existing state GET');
stateResolvers.shift()(response(oldState));
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls,2,'after successful POST a new /state must be fetched');
stateResolvers.shift()(response(newState));
assert.equal(await task,true,'successful profile POST must be reported');
assert.equal(window.__getState().users[0].name,'After','old pre-POST state must not hide the persisted profile');
assert.match(root.innerHTML,/After/,'UI must render the newly saved profile');
console.log('PASS: concurrent old GET and new profile POST produce a fresh state, safely rendered');

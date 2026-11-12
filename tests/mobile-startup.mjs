// Lightweight frontend startup smoke test; does NOT connect to live services or a database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../www/app.js', import.meta.url),'utf8');
new vm.Script(source,{filename:'app.js'});
function start(token){
 const nodes={app:{innerHTML:''}};
 const storage=new Map(token?[['po-puti-access-v2',token]]:[]);
 const noop=()=>{};
 const location={hash:'#/login',protocol:'https:'};
 const document={
  querySelector(selector){return selector==='#app'?nodes.app:null},
  addEventListener:noop,
  visibilityState:'visible',
  activeElement:{tagName:'BODY'}
 };
 const window={PO_PUTI_BACKEND:true,PO_PUTI_API_BASE:'',addEventListener:noop};
 const context={window,document,location,navigator:{onLine:true},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:()=>new Promise(noop),setInterval:noop,setTimeout:noop,clearTimeout:noop,console,Date,JSON,String,Number,Math,URL,Intl,AbortController,TextEncoder,crypto:globalThis.crypto,scrollTo:noop};
 vm.runInNewContext(source,context,{timeout:1500,filename:'app.js'});
 assert.match(nodes.app.innerHTML,/Вход|Регистрация|по пути/i,'Login screen must render without waiting for the server');
 return nodes.app.innerHTML.length;
}
const anonymous=start('');
const returning=start('previous-session-token');
console.log('Mobile startup smoke OK. Initial HTML lengths:',{anonymous,returning});

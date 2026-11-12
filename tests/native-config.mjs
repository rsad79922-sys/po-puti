import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const code=readFileSync(new URL('../www/config.js',import.meta.url),'utf8');
new vm.Script(code,{filename:'config.js'});
function load(platform){
 const window={};
 if(platform)window.Capacitor={getPlatform:()=>platform};
 vm.runInNewContext(code,{window});
 return {backend:window.PO_PUTI_BACKEND,base:window.PO_PUTI_API_BASE};
}
assert.deepEqual(load('android'),{backend:true,base:'https://vputipoputka.ru'});
assert.deepEqual(load('web'),{backend:false,base:''});
assert.deepEqual(load(),{backend:false,base:''});
console.log('PASS: Android uses same production API; standalone web demo retains local mode');

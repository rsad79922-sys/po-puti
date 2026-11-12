import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root=new URL('../www/',import.meta.url);
const sw=readFileSync(new URL('sw.js',root),'utf8');
const html=readFileSync(new URL('index.html',root),'utf8');
const app=readFileSync(new URL('app.js',root),'utf8');

assert.doesNotMatch(sw,/addEventListener\s*\(\s*['"]fetch['"]/, 'PWA must not intercept navigations until WebKit is verified');
assert.match(sw,/caches\.delete/, 'old poisoned PWA caches must be cleared');
assert.match(sw,/skipWaiting/);
assert.match(sw,/clients\.claim/);
assert.match(html,/id="boot-message"/, 'startup must be visible without JavaScript');
assert.match(html,/app\.js\?v=boot12/, 'app should use an explicit cache-busting version');
assert.match(html,/script\.onload=ready/, 'startup should wait for script execution');
assert.ok(html.indexOf('ready(){')<html.indexOf("style.href='/styles.css"), 'CSS must load after UI is rendered');
assert.doesNotMatch(app,/window\.addEventListener\('load',\(\)=>navigator\.serviceWorker\.register/, 'no duplicate worker registration');
new vm.Script(app,{filename:'www/app.js'});
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert.equal(inline.length,1,'exactly one small inline bootstrap');
new vm.Script(inline[0][1],{filename:'index-inline.js'});
new vm.Script(sw,{filename:'sw.js'});
console.log('PWA bootstrap static checks OK');

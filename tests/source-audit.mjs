/**
 * Cross-file audit for fatal punctuation mistakes, asset paths, and syntax.
 * Run: node tests/source-audit.mjs
 * Does not connect to production or modify data.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const files={
  'www/index.html':read('www/index.html'),
  'www/app.js':read('www/app.js'),
  'www/styles.css':read('www/styles.css'),
  'www/sw.js':read('www/sw.js'),
  'www/config.js':read('www/config.js'),
  'www/manifest.webmanifest':read('www/manifest.webmanifest'),
  'server/server.mjs':read('server/server.mjs'),
  'deploy/nginx-po-puti.conf':read('deploy/nginx-po-puti.conf'),
};
for(const [name,source] of Object.entries(files)){
  assert.doesNotMatch(source, /https?;\s*\/\//i, name+': semicolon used instead of colon in URL');
  assert.doesNotMatch(source, /127\.0\.0\.1;\d+/, name+': semicolon used instead of colon in port');
  assert.doesNotMatch(source, /https?:\/\/\s/, name+': space inside URL scheme');
}
for(const name of ['www/app.js','www/sw.js','www/config.js']){
  new vm.Script(files[name],{filename:name});
}
const scripts=[...files['www/index.html'].matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length,1,'one inline startup script');
new vm.Script(scripts[0][1],{filename:'index inline bootstrap'});
const manifest=JSON.parse(files['www/manifest.webmanifest']);
assert.equal(manifest.scope,'./');
assert.ok(manifest.start_url.startsWith('./'));
const nginx=read('deploy/nginx-po-puti-tls.conf');
const proxyTargets=[...nginx.matchAll(/proxy_pass\s+([^;]+);/g)].map(m=>m[1]);
assert.ok(proxyTargets.length>0,'nginx backend proxy must exist');
assert.ok(proxyTargets.every(v=>v==='http://127.0.0.1:8080'), 'nginx proxy URL invalid');
const html=files['www/index.html'];
assert.match(html, /id="app"/);
assert.match(html, /id="boot-message"/);
assert.match(html, /script\.onload=ready/);
assert.match(html, /window\.PO_PUTI_BACKEND=true/);
assert.match(files['www/sw.js'], /addEventListener\s*\(\s*['"]fetch['"]/, 'Network First handler required');
assert.match(files['www/sw.js'], /NETWORK_TIMEOUT_MS = 15000/);
let level=0;
const css=files['www/styles.css'];
for(const match of css.matchAll(/[{}]/g)){
  level+=match[0]==='{'?1:-1;
  assert.ok(level>=0,'CSS has an unexpected closing brace');
}
assert.equal(level,0,'CSS has unbalanced braces');
console.log('Source syntax / URL punctuation / PWA & Nginx audit OK:',Object.keys(files).length,'files');

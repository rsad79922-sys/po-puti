import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,rename,unlink,symlink,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {clientConfig,androidDownloadUrl} from '../server/client-config.mjs';
import {isolatedServer} from './helpers/server.mjs';

assert.equal(clientConfig({}).androidDownloadUrl,'');
for(const invalid of ['', 'javascript:alert(1)','data:application/vnd.android.package-archive,x','http://example.org/app.apk','//example.org/app.apk','https://user:password@example.org/app.apk','https://example.org/\nfile.apk','https://example.org/\\file.apk'])assert.equal(androidDownloadUrl(invalid),'');
for(const url of ['https://vputipoputka.ru/downloads/po-puti.apk','https://www.rustore.ru/catalog/app/ru.poputi.app'])assert.equal(clientConfig({ANDROID_DOWNLOAD_URL:url}).androidDownloadUrl,url);

// Downloads must bypass the PWA worker, including navigation requests: streaming
// an APK must never inherit the shell timeout/cache or an offline HTML fallback.
const listeners={};
vm.runInNewContext(await readFile('www/sw.js','utf8'),{self:{location:{origin:'https://vputipoputka.ru'},addEventListener:(name,fn)=>{listeners[name]=fn}},URL});
for(const method of ['GET','HEAD'])listeners.fetch({request:{method,url:'https://vputipoputka.ru/downloads/po-puti.apk',mode:'navigate'},respondWith:()=>assert.fail('APK must bypass the Service Worker')});

const app=await isolatedServer({ANDROID_DOWNLOAD_URL:'https://vputipoputka.ru/downloads/po-puti.apk',YANDEX_RASP_API_KEY:'not-a-public-config-value'});
try{
 const config=await fetch(app.base+'/api/public-config');assert.equal(config.status,200);
 assert.equal(config.headers.get('cache-control'),'no-store');
 const publicConfig=await config.json();assert.equal(publicConfig.androidDownloadUrl,'https://vputipoputka.ru/downloads/po-puti.apk');
 assert(!JSON.stringify(publicConfig).includes('not-a-public-config-value'));
 const url=app.base+'/downloads/po-puti.apk',path=app.dir+'/downloads/po-puti.apk';
 assert.equal((await fetch(url)).status,404,'no placeholder APK or SPA HTML before publication');
 await mkdir(app.dir+'/downloads',{mode:0o700});
 await writeFile(path,Buffer.alloc(0));assert.equal((await fetch(url)).status,404,'empty candidates are not downloadable');
 await unlink(path);await symlink(app.dir+'/po-puti.sqlite',path);assert.equal((await fetch(url)).status,404,'never follow a link to private data');await unlink(path);
 // A binary fixture exercises hosting only; this is never an installable release.
 const binary=Buffer.alloc(2*1024*1024,23);binary.write('PK\x03\x04');await writeFile(path,binary,{mode:0o600});
 const response=await fetch(url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/vnd.android.package-archive');
 assert.equal(response.headers.get('content-disposition'),'attachment; filename="po-puti.apk"');assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(Number(response.headers.get('content-length')),binary.length);assert.deepEqual(Buffer.from(await response.arrayBuffer()),binary);
 const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),binary.length);assert.equal(await head.text(),'');
 await writeFile(path+'.next',binary.subarray(0,4096));await rename(path+'.next',path);
 assert.equal(Number((await fetch(url,{method:'HEAD'})).headers.get('content-length')),4096,'atomic publication serves the new file without stale cache');
 await writeFile(app.dir+'/downloads/signing.keystore','private test fixture');
 for(const suffix of ['/downloads/','/downloads/signing.keystore','/downloads/po-puti.apk.next','/downloads/other.apk','/downloads/%2e%2e/po-puti.sqlite'])assert.equal((await fetch(app.base+suffix)).status,404,suffix+' must remain private');
 assert.equal((await fetch(url,{method:'POST'})).status,405,'HTTP must not support APK upload or replacement');
 console.log('PASS: one HTTPS download setting, safe public config, streamed APK/HEAD, atomic replacement, no directory/private-file exposure, SW bypass');
}finally{await app.stop()}
const protectedDir=await mkdtemp(join(tmpdir(),'poputi-apk-distribution-')),secured=await isolatedServer({ANDROID_APK_DIR:protectedDir});
try{
 await writeFile(join(protectedDir,'po-puti.apk'),'protected distribution fixture');
 await mkdir(secured.dir+'/downloads');await writeFile(secured.dir+'/downloads/po-puti.apk','stale app-owned fixture');
 const response=await fetch(secured.base+'/downloads/po-puti.apk');assert.equal(response.status,200);assert.equal(await response.text(),'protected distribution fixture','configured APK directory must take precedence over app-writable data');
 console.log('PASS: APK distribution can live outside the web application writable data directory');
}finally{await secured.stop();await rm(protectedDir,{recursive:true,force:true})}

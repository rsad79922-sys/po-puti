import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,symlink,unlink,lstat} from 'node:fs/promises';
import {publicAndroidRelease} from '../server/android-download.mjs';
import {isolatedServer} from './helpers/server.mjs';

const metadata={package:'ru.poputi.app',versionCode:10,versionName:'1.3.0',bytes:7,apkSHA256:'a'.repeat(64),certificateSHA256:'b'.repeat(64),privateKey:'must never be public'};
const expected=publicAndroidRelease(metadata);assert(!('privateKey' in expected));
for(const changes of [{package:'wrong'},{versionCode:0},{versionCode:1.2},{versionCode:1e12},{versionName:'<script>'},{bytes:0},{bytes:1e12},{apkSHA256:'bad'},{certificateSHA256:'bad'}])assert.throws(()=>publicAndroidRelease({...metadata,...changes}));
const app=await isolatedServer();
try{
 const url=app.base+'/downloads/android-release.json',dir=app.dir+'/downloads';
 assert.equal((await fetch(url)).status,404);
 await mkdir(dir);await writeFile(dir+'/android-release.json',JSON.stringify(metadata));
 assert.equal((await fetch(url)).status,404,'never offer metadata without its exact immutable APK');
 await writeFile(dir+'/po-puti-10.apk','fixture');
 const res=await fetch(url);assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');assert.deepEqual(await res.json(),expected);
 const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal(await (await fetch(app.base+'/downloads/po-puti-10.apk')).text(),'fixture');
 await unlink(dir+'/po-puti-10.apk');await symlink(app.dir+'/po-puti.sqlite',dir+'/po-puti-10.apk');assert.equal((await fetch(url)).status,404);assert.equal((await fetch(app.base+'/downloads/po-puti-10.apk')).status,404);await unlink(dir+'/po-puti-10.apk');
 await unlink(dir+'/android-release.json');await symlink(app.dir+'/po-puti.sqlite',dir+'/android-release.json');assert.equal((await fetch(url)).status,404);
 for(const file of ['android-release.json.next','release-info.json','po-puti-0.apk','po-puti-10.apk.next'])assert.equal((await fetch(app.base+'/downloads/'+file)).status,404);
 assert.equal((await fetch(url,{method:'POST'})).status,405);
 assert.equal((await fetch(app.base+'/install.html')).status,200);
 console.log('PASS: allowlisted no-store release metadata, immutable APK, absent files, no symlink/private-file exposure, install page');
}finally{await app.stop()}

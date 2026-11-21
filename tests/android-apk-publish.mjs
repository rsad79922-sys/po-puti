import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installDownload,downloadEnvironment,DOWNLOAD_URL} from '../scripts/publish-android-apk.mjs';
import {sha256} from '../scripts/android-signing-vault.mjs';
const root=await mkdtemp(join(tmpdir(),'poputi-apk-publish-'));
try{
 assert.equal(downloadEnvironment('EXISTING=preserved\nANDROID_DOWNLOAD_URL=old\nPORT=8080\n').match(/ANDROID_DOWNLOAD_URL=/g).length,1);
 assert.equal(downloadEnvironment('ANDROID_APK_DIR=/old\nANDROID_DOWNLOAD_URL=old\n',DOWNLOAD_URL,'/var/lib/po-puti-downloads'),'ANDROID_APK_DIR=/var/lib/po-puti-downloads\nANDROID_DOWNLOAD_URL='+DOWNLOAD_URL+'\n');
 for(const oldApk of [false,true]){
  const dir=join(root,oldApk?'previous':'first'),dataDir=join(dir,'data'),downloadsDir=join(dir,'distribution'),envFile=join(dir,'app.env'),artifact=join(dir,'release.apk');
  await mkdir(dataDir,{recursive:true,mode:0o700});await mkdir(downloadsDir,{mode:0o700});await writeFile(join(dataDir,'user.sqlite'),'user database sentinel');await mkdir(join(dataDir,'uploads'));await writeFile(join(dataDir,'uploads','user-photo'),'user photo sentinel');
  const original='PRIVATE_SETTING=must-stay-private\nPORT=8080\n';await writeFile(envFile,original,{mode:0o600});await writeFile(artifact,'new APK fixture');if(oldApk)await writeFile(join(downloadsDir,'po-puti.apk'),'old APK fixture');
  let restarts=0;const digest=await sha256(artifact),metadata={package:'ru.poputi.app',versionCode:10,versionName:'1.3.0',certificateSHA256:'a'.repeat(64),apkSHA256:digest,bytes:15};
  const config={artifact,expectedSha:digest,dataDir,downloadsDir,envFile,backupDir:join(dir,'backups'),metadata,restart:async()=>{restarts++}};
  await assert.rejects(()=>installDownload({...config,probe:async()=>false}),/health verification/);assert.equal(await readFile(envFile,'utf8'),original);assert.equal(restarts,2);
  if(oldApk)assert.equal(await readFile(join(downloadsDir,'po-puti.apk'),'utf8'),'old APK fixture');else await assert.rejects(()=>lstat(join(downloadsDir,'po-puti.apk')),/ENOENT/);
  await assert.rejects(()=>lstat(join(downloadsDir,'android-release.json')),/ENOENT/);await assert.rejects(()=>lstat(join(downloadsDir,'po-puti-10.apk')),/ENOENT/);
  const result=await installDownload({...config,probe:async()=>true});assert.equal(result.url,DOWNLOAD_URL);assert.equal(await readFile(join(downloadsDir,'po-puti.apk'),'utf8'),'new APK fixture');assert.equal((await lstat(downloadsDir)).mode&0o777,0o750);assert.equal((await lstat(join(downloadsDir,'po-puti.apk'))).mode&0o777,0o640);
  assert.equal(await readFile(envFile,'utf8'),downloadEnvironment(original,DOWNLOAD_URL,downloadsDir));assert.equal(await readFile(join(result.backup,'po-puti.env'),'utf8'),original);assert.equal((await lstat(join(result.backup,'po-puti.env'))).mode&0o777,0o600);
  assert.equal(await readFile(join(dataDir,'user.sqlite'),'utf8'),'user database sentinel');assert.equal(await readFile(join(dataDir,'uploads','user-photo'),'utf8'),'user photo sentinel');
  const release=JSON.parse(await readFile(join(downloadsDir,'android-release.json'),'utf8'));assert.equal(release.versionCode,10);assert.equal(release.downloadUrl,'https://vputipoputka.ru/downloads/po-puti-10.apk');assert.equal(await readFile(join(downloadsDir,'po-puti-10.apk'),'utf8'),'new APK fixture');
  await assert.rejects(()=>installDownload({...config,probe:async()=>true}),/downgrade\/reuse/);
  await assert.rejects(()=>installDownload({...config,metadata:{...metadata,versionCode:11,certificateSHA256:'b'.repeat(64)},probe:async()=>true}),/signing-key change/);
  await assert.rejects(()=>installDownload({...config,metadata:{...metadata,versionCode:11},probe:async()=>false}),/health verification/);
  assert.deepEqual(JSON.parse(await readFile(join(downloadsDir,'android-release.json'),'utf8')),release);assert.equal(await readFile(join(downloadsDir,'po-puti-10.apk'),'utf8'),'new APK fixture');await assert.rejects(()=>lstat(join(downloadsDir,'po-puti-11.apk')),/ENOENT/);
 }
 console.log('PASS: atomic APK install, root-owned read-only distribution, single URL setting, private env backup, health-failure rollback and preserved user DB/photos');
}finally{await rm(root,{recursive:true,force:true})}

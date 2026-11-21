import {readFile,writeFile,mkdir,lstat,chmod,chown,copyFile,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {sha256,SIGNING_VAULT} from './android-signing-vault.mjs';
import {publicAndroidRelease,readAndroidRelease} from '../server/android-download.mjs';

export const DOWNLOAD_URL='https://vputipoputka.ru/downloads/po-puti.apk';
export function downloadEnvironment(text,url=DOWNLOAD_URL,apkDir){
 const preserved=text.split(/\r?\n/).filter(line=>!/^\s*ANDROID_DOWNLOAD_URL\s*=/.test(line)&&(!apkDir||!/^\s*ANDROID_APK_DIR\s*=/.test(line))).join('\n').replace(/\n*$/,'');
 return (preserved?preserved+'\n':'')+(apkDir?'ANDROID_APK_DIR='+apkDir+'\n':'')+'ANDROID_DOWNLOAD_URL='+url+'\n';
}
async function atomic(path,body,mode,uid,gid){
 const temp=path+'.next-'+randomUUID();
 await writeFile(temp,body,{mode,flag:'wx',flush:true});await chown(temp,uid,gid);await chmod(temp,mode);await rename(temp,path);
}
async function exists(path){try{return await lstat(path)}catch(error){if(error.code==='ENOENT')return null;throw error}}
export async function installDownload({artifact,expectedSha,dataDir,downloadsDir,envFile,backupDir,groupId=process.getgid(),restart,probe,url=DOWNLOAD_URL,metadata}){
 if(await sha256(artifact)!==expectedSha)throw Error('Candidate APK digest mismatch');
 const envInfo=await lstat(envFile);
 if(!envInfo.isFile()||envInfo.isSymbolicLink()||envInfo.uid!==process.getuid()||(envInfo.mode&0o022)!==0)throw Error('Unsafe server environment file');
 const oldEnv=await readFile(envFile),downloads=downloadsDir||join(dataDir,'downloads'),destination=join(downloads,'po-puti.apk');
 await mkdir(downloads,{recursive:true,mode:0o750});const directory=await lstat(downloads);
 if(!directory.isDirectory()||directory.isSymbolicLink())throw Error('Unsafe APK download directory');
 // The web service can read APKs but cannot replace the signed distribution.
 await chown(downloads,process.getuid(),groupId);await chmod(downloads,0o750);
 const release=publicAndroidRelease(metadata),releasePath=join(downloads,'android-release.json');
 if(release&&(release.apkSHA256!==expectedSha||(await lstat(artifact)).size!==release.bytes))throw Error('Public release does not match APK');
 const oldRelease=await readAndroidRelease(downloads);
 if(oldRelease&&(!release||release.certificateSHA256!==oldRelease.certificateSHA256||release.versionCode<=oldRelease.versionCode))throw Error('Refusing signing-key change or release downgrade/reuse');
 const previousRelease=await exists(releasePath);
 if(previousRelease&&(!previousRelease.isFile()||previousRelease.isSymbolicLink()))throw Error('Unsafe release metadata file');
 const oldReleaseBody=previousRelease?await readFile(releasePath):null;
 const versioned=release?join(downloads,'po-puti-'+release.versionCode+'.apk'):null;
 if(versioned&&await exists(versioned))throw Error('Immutable release APK already exists');
 const previous=await exists(destination);
 if(previous&&(!previous.isFile()||previous.isSymbolicLink()))throw Error('Existing APK path is not a regular file');
 const backup=join(backupDir,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());
 await mkdir(backup,{recursive:true,mode:0o700});await chmod(backup,0o700);
 await writeFile(join(backup,'po-puti.env'),oldEnv,{mode:0o600,flag:'wx',flush:true});
 if(previous){await copyFile(destination,join(backup,'previous.apk'),constants.COPYFILE_EXCL);await chmod(join(backup,'previous.apk'),0o600)}
 if(oldReleaseBody)await writeFile(join(backup,'android-release.json'),oldReleaseBody,{mode:0o600,flag:'wx',flush:true});
 const temp=destination+'.next-'+randomUUID(),versionTemp=versioned+'.next-'+randomUUID();let installed=false,versionedInstalled=false,manifestInstalled=false;
 try{
  await copyFile(artifact,versionTemp,constants.COPYFILE_EXCL);await chown(versionTemp,process.getuid(),groupId);await chmod(versionTemp,0o640);await rename(versionTemp,versioned);versionedInstalled=true;
  await copyFile(artifact,temp,constants.COPYFILE_EXCL);await chown(temp,process.getuid(),groupId);await chmod(temp,0o640);await rename(temp,destination);installed=true;
  if(release){await atomic(releasePath,JSON.stringify(release)+'\n',0o640,process.getuid(),groupId);manifestInstalled=true;}
  await atomic(envFile,downloadEnvironment(oldEnv.toString('utf8'),url,downloadsDir),envInfo.mode&0o777,envInfo.uid,envInfo.gid);
  await restart();if(!await probe())throw Error('APK/public-config health verification failed');
  return {url,apkSHA256:expectedSha,backup};
 }catch(error){
  await atomic(envFile,oldEnv,envInfo.mode&0o777,envInfo.uid,envInfo.gid);
  if(manifestInstalled){if(oldReleaseBody)await atomic(releasePath,oldReleaseBody,previousRelease.mode&0o777,previousRelease.uid,previousRelease.gid);else await unlink(releasePath);}
  if(installed){
   if(previous){const restore=destination+'.restore-'+randomUUID();await copyFile(join(backup,'previous.apk'),restore,constants.COPYFILE_EXCL);await chown(restore,previous.uid,previous.gid);await chmod(restore,previous.mode&0o777);await rename(restore,destination)}
   else if(await sha256(destination)===expectedSha)await unlink(destination); // Only our failed candidate.
  }
  if(versionedInstalled)await unlink(versioned); // Only this failed candidate; older releases remain available.
  try{await unlink(versionTemp)}catch(failure){if(failure.code!=='ENOENT')throw failure}
  try{await unlink(temp)}catch(failure){if(failure.code!=='ENOENT')throw failure}
  await restart();throw error;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  process.umask(0o077);if(process.getuid()!==0)throw Error('APK publication requires root on the VPS');
  const [stage,sourceSha]=process.argv.slice(2);
  if(!/^\/var\/lib\/po-puti-android-builds\/run-[0-9]+-[0-9]+$/.test(stage||'')||resolve(stage)!==stage||!/^[a-f0-9]{40}$/.test(sourceSha||''))throw Error('Unexpected publication stage or revision');
  const stageInfo=await lstat(stage);if(stageInfo.isSymbolicLink()||stageInfo.uid!==0||(stageInfo.mode&0o077)!==0)throw Error('Unsafe publication stage');
  const metadata=JSON.parse(await readFile(join(stage,'release-info.json'),'utf8'));
  const certificate=new X509Certificate(await readFile(join(SIGNING_VAULT,'certificate.pem')));
  if(metadata.package!=='ru.poputi.app'||metadata.versionCode<4||metadata.sourceSha!==sourceSha||metadata.certificateSHA256!==certificate.fingerprint256.replaceAll(':','').toLowerCase())throw Error('Release metadata differs from the permanent direct signing identity');
  try{execFileSync('java',['-jar',join(stage,'apksigner.jar'),'verify','--verbose',join(stage,'po-puti-release.apk')],{stdio:['ignore','pipe','pipe'],timeout:30000})}catch{throw Error('Refusing to publish an APK with an invalid digital signature')}
  const groupId=Number(execFileSync('id',['-g','poputi'],{encoding:'utf8'}).trim());
  const envFile='/etc/po-puti/po-puti.env',env=await readFile(envFile,'utf8');
  const configured=env.match(/^DATA_DIR=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'');if(configured&&configured!=='/var/lib/po-puti')throw Error('Unexpected DATA_DIR; automatic publication refused');
  const restart=async()=>{try{execFileSync('systemctl',['restart','po-puti'],{stdio:['ignore','pipe','pipe'],timeout:30000})}catch{throw Error('Application restart failed')}};
  const probe=async()=>{
   for(let i=0;i<60;i++){
    try{
     const health=await fetch('http://127.0.0.1:8080/api/health',{signal:AbortSignal.timeout(3000)}),config=await fetch('http://127.0.0.1:8080/api/public-config',{signal:AbortSignal.timeout(3000)}),apk=await fetch('http://127.0.0.1:8080/downloads/po-puti.apk',{method:'HEAD',signal:AbortSignal.timeout(3000)});
     const update=await fetch('http://127.0.0.1:8080/downloads/android-release.json',{signal:AbortSignal.timeout(3000)});
     if(health.ok&&(await health.json()).ok&&config.ok&&(await config.json()).androidDownloadUrl===DOWNLOAD_URL&&apk.ok&&Number(apk.headers.get('content-length'))===metadata.bytes&&update.ok&&(await update.json()).apkSHA256===metadata.apkSHA256)return true;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
   }return false;
  };
  const result=await installDownload({artifact:join(stage,'po-puti-release.apk'),expectedSha:metadata.apkSHA256,dataDir:'/var/lib/po-puti',downloadsDir:'/var/lib/po-puti-downloads',envFile,backupDir:'/var/backups/po-puti-android-publish',groupId,restart,probe,metadata});
  console.log('ANDROID_DIRECT_DOWNLOAD_PUBLISHED '+JSON.stringify(result));
 }catch(error){console.error('ANDROID_DIRECT_DOWNLOAD_PUBLISH_FAILED: '+error.message);process.exitCode=1}
}

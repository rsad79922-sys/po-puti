import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {join} from 'node:path';

export function publicAndroidRelease(value){
 if(!value||value.package!=='ru.poputi.app'||!Number.isSafeInteger(value.versionCode)||value.versionCode<4||value.versionCode>999999999||typeof value.versionName!=='string'||!/^\d+(?:\.\d+){1,3}$/.test(value.versionName)||!Number.isSafeInteger(value.bytes)||value.bytes<=0||value.bytes>200*1024*1024||typeof value.apkSHA256!=='string'||!/^([a-f0-9]{64})$/.test(value.apkSHA256)||typeof value.certificateSHA256!=='string'||!/^([a-f0-9]{64})$/.test(value.certificateSHA256))throw Error('Invalid public Android release');
 return {package:value.package,versionCode:value.versionCode,versionName:value.versionName,bytes:value.bytes,apkSHA256:value.apkSHA256,certificateSHA256:value.certificateSHA256,downloadUrl:'https://vputipoputka.ru/downloads/po-puti-'+value.versionCode+'.apk'};
}
export async function readAndroidRelease(directory){
 let file;
 try{
  file=await open(join(directory,'android-release.json'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=await file.stat();if(!stat.isFile()||stat.size>16384)throw Error('Invalid Android release metadata');
  return publicAndroidRelease(JSON.parse(await file.readFile('utf8')));
 }catch(error){if(['ENOENT','ENOTDIR','ELOOP'].includes(error.code))return null;throw error}
 finally{await file?.close()}
}
export async function serveAndroidRelease(req,res,directory){
 const release=await readAndroidRelease(directory);if(!release)return false;
 let apk;
 try{
  apk=await open(join(directory,'po-puti-'+release.versionCode+'.apk'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const info=await apk.stat();if(!info.isFile()||info.size!==release.bytes)return false;
 }catch(error){if(['ENOENT','ENOTDIR','ELOOP'].includes(error.code))return false;throw error}
 finally{await apk?.close()}
 const body=JSON.stringify(release);res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(body)});res.end(req.method==='HEAD'?undefined:body);return true;
}

// Only the explicitly published APK is public. Never enumerate the data directory
// or follow a symlink to a database, keystore, backup or user upload.
export async function serveAndroidApk(req,res,path){
 let file;
 try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)}
 catch(error){if(['ENOENT','ENOTDIR','ELOOP'].includes(error.code))return false;throw error}
 try{
  const info=await file.stat();
  if(!info.isFile()||info.size===0)return false;
  res.writeHead(200,{
   'content-type':'application/vnd.android.package-archive',
   'content-disposition':'attachment; filename="po-puti.apk"',
   'content-length':info.size,
   'cache-control':'no-store',
   'x-content-type-options':'nosniff'
  });
  if(req.method==='HEAD')res.end();
  else try{await pipeline(file.createReadStream(),res)}catch{res.destroy()}
  return true;
 }finally{await file.close()}
}

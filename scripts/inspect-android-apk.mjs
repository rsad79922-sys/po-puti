// Read-only public APK metadata. Does not accept or load signing keys/passwords.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

function inspectWith(binary,args,message){
 try{return execFileSync(binary,args,{encoding:'utf8',timeout:15000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']})}
 catch{throw Error(message)} // Do not echo arbitrary subprocess output or environment.
}

export function parseApkMetadata(badging,verification){
 const line=badging.split(/\r?\n/).find(value=>value.startsWith('package: '))||'';
 const fields=new Map();
 for(const match of line.slice('package: '.length).matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9_]*)='((?:\\.|[^'\\])*)'/g)){
  if(fields.has(match[1]))throw Error('APK package metadata is ambiguous');
  fields.set(match[1],match[2].replace(/\\(['\\])/g,'$1'));
 }
 const pkg=fields.get('name'),versionText=fields.get('versionCode');
 const versionCode=Number(versionText);
 if(!/^[A-Za-z][A-Za-z0-9_.]+$/.test(pkg||'')||!/^\d+$/.test(versionText||'')||!Number.isSafeInteger(versionCode)||versionCode<1||versionCode>2100000000)throw Error('APK package/versionCode metadata is missing or invalid');
 const signers=[];
 for(const match of verification.matchAll(/^Signer #(\d+) certificate SHA-256 digest: ([A-Fa-f0-9:]+)\s*$/gm)){
  const index=Number(match[1]),certificateSHA256=match[2].replaceAll(':','').toLowerCase();
  if(!Number.isSafeInteger(index)||index<1||index>32||!/^[a-f0-9]{64}$/.test(certificateSHA256)||signers.some(s=>s.index===index))throw Error('APK signer metadata is invalid or ambiguous');
  signers.push({index,certificateSHA256});
 }
 signers.sort((a,b)=>a.index-b.index);
 if(!signers.length||signers.some((signer,i)=>signer.index!==i+1))throw Error('Verified APK signer certificates were not found or are incomplete');
 const declared=verification.match(/^Number of signers:\s*(\d+)\s*$/m)?.[1];
 if(declared!==undefined&&Number(declared)!==signers.length)throw Error('APK signer count does not match certificate metadata');
 return {package:pkg,versionCode,versionName:fields.get('versionName')||'',debuggable:/^application-debuggable(?:\s|$)/m.test(badging),singleSigner:signers.length===1,certificateSHA256:signers.length===1?signers[0].certificateSHA256:null,signers};
}

export async function inspectApk(apk,{aapt=process.env.AAPT||'aapt',apksigner=process.env.APKSIGNER||'apksigner'}={}){
 if(typeof apk!=='string'||!apk)throw Error('Usage: node scripts/inspect-android-apk.mjs /path/to/submitted.apk');
 const path=resolve(apk);let info;
 try{info=await stat(path)}catch{throw Error('APK file is not accessible')}
 if(!info.isFile()||info.size===0)throw Error('APK must be a nonempty regular file');
 const badging=inspectWith(aapt,['dump','badging',path],'Unable to read APK metadata with aapt');
 const verification=inspectWith(apksigner,['verify','--verbose','--print-certs',path],'APK signature verification failed or apksigner is unavailable');
 const metadata=parseApkMetadata(badging,verification);
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
 return {...metadata,apkSHA256:hash.digest('hex'),bytes:info.size};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==3)throw Error('Usage: node scripts/inspect-android-apk.mjs /path/to/submitted.apk');
  console.log(JSON.stringify(await inspectApk(process.argv[2]),null,2));
 }catch(error){console.error('APK_INSPECTION_FAILED: '+error.message);process.exitCode=1}
}

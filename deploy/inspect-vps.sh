#!/usr/bin/env bash
# Isolated signing diagnostics. Never print key/password bytes or signing stderr.
set -euo pipefail
node --input-type=module <<'JS'
import {spawnSync} from 'node:child_process';
import {lstat,readFile,rm} from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
const stage='/var/lib/po-puti-android-builds/run-44284676549-1';
const vault='/etc/po-puti/android-signing';
const j=spawnSync('java',['-version'],{encoding:'utf8'});
console.log('SIGNER_JAVA_VERSION',j.stderr.match(/version "([0-9._+\-]+)"/)?.[1]||'unavailable');
const v=spawnSync('java',['-jar',stage+'/apksigner.jar','version'],{encoding:'utf8'});
console.log('PUBLIC_TOOL_VERSION',JSON.stringify({status:v.status,stdout:v.stdout.trim().slice(0,120),stderr:v.stderr.trim().slice(0,500)}));
for(const name of ['po-puti-release.p12','store-password','certificate.pem']){const s=await lstat(vault+'/'+name);console.log('VAULT_FILE_STATE',JSON.stringify({name,uid:s.uid,mode:(s.mode&0o777).toString(8),regular:s.isFile()}))}
const c=new X509Certificate(await readFile(vault+'/certificate.pem'));console.log('PUBLIC_SIGNING_CERTIFICATE_SHA256',c.fingerprint256);
const out=stage+'/diagnostic-candidate.apk';
try{await lstat(out);throw Error('Diagnostic output already exists')}catch(e){if(e.code!=='ENOENT')throw e}
const r=spawnSync('java',['-jar',stage+'/apksigner.jar','sign','--ks',vault+'/po-puti-release.p12','--ks-type','PKCS12','--ks-key-alias','po-puti-direct-release','--ks-pass','file:'+vault+'/store-password','--key-pass','file:'+vault+'/store-password','--v4-signing-enabled','false','--out',out,stage+'/release-aligned.apk'],{encoding:'utf8',timeout:60000});
const message=String(r.stderr||'')+'\n'+String(r.stdout||'');
const rules={java_version:/UnsupportedClassVersionError|class file version/,unknown_option:/Unknown option|Unsupported option|Invalid option|Unrecognized option/,keystore_load:/Failed to load signer|Keystore was tampered|password was incorrect|Cannot recover key|UnrecoverableKeyException/,pkcs12_algorithm:/parseAlgParameters|AlgorithmParameters|ObjectIdentifier|HmacPBESHA|Unsupported tag/,missing_class:/NoClassDefFoundError|ClassNotFoundException/,permission:/Permission denied|AccessDeniedException/,bad_jar:/Invalid or corrupt jarfile|Unable to access jarfile|Could not find or load main class/};
console.log('SIGNING_DIAGNOSTIC',JSON.stringify({status:r.status,signal:r.signal,errorCode:r.error?.code,matches:Object.keys(rules).filter(k=>rules[k].test(message)),exceptionClasses:[...new Set(message.match(/(?:java|javax|com\.android|sun|org\.bouncycastle)\.[A-Za-z0-9_.]+(?:Exception|Error)/g)||[])]}));
await rm(out,{force:true});
JS

// The production signing key is created and used ONLY on the VPS. Never return
// passwords/private keys to CI, command arguments, logs, artifacts or Git.
import {lstat,mkdir,writeFile,readFile,chmod,copyFile,rename,rm,mkdtemp} from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash,X509Certificate} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const SIGNING_ALIAS='po-puti-direct-release';
export const SIGNING_VAULT='/etc/po-puti/android-signing';
export const SIGNING_BACKUP='/var/backups/po-puti-android-signing';
const files={key:'po-puti-release.p12',password:'store-password',certificate:'certificate.pem'};
function run(binary,args,message){
 try{return execFileSync(binary,args,{timeout:120000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']})}
 catch{throw Error(message)} // Child output can contain sensitive diagnostics.
}
async function info(path){try{return await lstat(path)}catch(error){if(error.code==='ENOENT')return null;throw error}}
async function privateDirectory(path){
 await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid())throw Error('Signing directory is not owned by the current trusted user');
 await chmod(path,0o700);
}
async function privateFile(path){
 const s=await info(path);
 if(!s?.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)!==0)throw Error('Signing file is missing or has unsafe ownership/permissions');
 return s;
}
export async function sha256(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex')}
function certificate(vault){
 const der=run('keytool',['-exportcert','-keystore',join(vault,files.key),'-storetype','PKCS12','-alias',SIGNING_ALIAS,'-storepass:file',join(vault,files.password)],'Unable to verify the existing release keystore');
 return new X509Certificate(der);
}
export async function prepareVault(vault,{keySize=4096}={}){
 await privateDirectory(vault);
 const key=join(vault,files.key),password=join(vault,files.password),cert=join(vault,files.certificate);
 const [keyInfo,passwordInfo,certInfo]=await Promise.all([info(key),info(password),info(cert)]);
 let created=false;
 if(!keyInfo&&!passwordInfo&&!certInfo){
  const temp=await mkdtemp(join(vault,'.create-'));
  try{
   await writeFile(join(temp,files.password),randomBytes(48).toString('base64url')+'\n',{mode:0o600,flag:'wx'});
   run('keytool',['-genkeypair','-noprompt','-storetype','PKCS12','-keystore',join(temp,files.key),'-alias',SIGNING_ALIAS,'-keyalg','RSA','-keysize',String(keySize),'-sigalg','SHA256withRSA','-validity','10000','-dname','CN=Po Puti Direct Android Release, OU=Mobile, O=Po Puti, C=RU','-storepass:file',join(temp,files.password),'-keypass:file',join(temp,files.password)],'Unable to create the permanent release keystore');
   await chmod(join(temp,files.key),0o600);
   // Exclusive copies fail closed rather than overwrite a key created elsewhere.
   await copyFile(join(temp,files.key),key,constants.COPYFILE_EXCL);
   await copyFile(join(temp,files.password),password,constants.COPYFILE_EXCL);
   created=true;
  }finally{await rm(temp,{recursive:true,force:true})}
 }else if(!keyInfo||!passwordInfo){throw Error('Incomplete signing vault; existing files were preserved')}
 await privateFile(key);await privateFile(password);
 const x509=certificate(vault),fingerprint=x509.fingerprint256.replaceAll(':','').toLowerCase();
 if(certInfo){await privateFile(cert);if(new X509Certificate(await readFile(cert)).fingerprint256!==x509.fingerprint256)throw Error('Existing public certificate does not match the permanent key')}
 else await writeFile(cert,x509.toString()+'\n',{mode:0o600,flag:'wx'});
 return {created,alias:SIGNING_ALIAS,storeType:'PKCS12',certificateSHA256:fingerprint,certificateSubject:x509.subject,validTo:x509.validTo};
}
export async function backupVault(vault,backup){
 await privateDirectory(backup);
 await privateFile(join(vault,files.key));await privateFile(join(vault,files.password));
 const x509=certificate(vault),fingerprint=x509.fingerprint256.replaceAll(':','').toLowerCase();
 const dest=join(backup,'po-puti-release-'+fingerprint.slice(0,16)+'.p12');
 const existing=await info(dest);
 if(existing){await privateFile(dest);if(await sha256(dest)!==await sha256(join(vault,files.key)))throw Error('Existing key backup differs; it was not overwritten')}
 else{await copyFile(join(vault,files.key),dest,constants.COPYFILE_EXCL);await chmod(dest,0o600)}
 // Password deliberately stays in the vault; back it up separately in a password manager.
 return {keyBackup:dest,passwordLocation:join(vault,files.password)};
}
async function sign(vault,jar,input,output,expectedCertificate){
 await privateFile(input);await privateFile(jar);
 const temp=output+'.next';if(await info(temp)||await info(output))throw Error('Signing output already exists; files were preserved');
 try{
  run('java',['-jar',jar,'sign','--ks',join(vault,files.key),'--ks-type','PKCS12','--ks-key-alias',SIGNING_ALIAS,'--ks-pass','file:'+join(vault,files.password),'--key-pass','file:'+join(vault,files.password),'--v4-signing-enabled','false','--out',temp,input],'APK signing failed; the private key remains on the VPS');
  await chmod(temp,0o600);
  const verification=run('java',['-jar',jar,'verify','--verbose','--print-certs',temp],'APK signature verification failed').toString('utf8');
  const signers=[...verification.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9:]+)\s*$/gm)].map(m=>m[1].replaceAll(':','').toLowerCase());
  if(signers.length!==1||signers[0]!==expectedCertificate)throw Error('Signed APK has an unexpected certificate');
  await rename(temp,output);
  return {apkSHA256:await sha256(output),bytes:(await lstat(output)).size};
 }catch(error){await rm(temp,{force:true});throw error}
}
export async function signStage(stage,{vault=SIGNING_VAULT,backup=SIGNING_BACKUP,versionCode,versionName,sourceSha}={}){
 if(!Number.isInteger(versionCode)||versionCode<4||versionCode>999999999||!/^\d+(?:\.\d+){1,3}$/.test(versionName||'')||!/^[a-f0-9]{40}$/.test(sourceSha||''))throw Error('Invalid direct release metadata; RuStore version 3 must remain unchanged');
 const s=await lstat(stage);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)!==0)throw Error('Build stage must be a private trusted directory');
 const key=await prepareVault(vault);await backupVault(vault,backup);
 const jar=join(stage,'apksigner.jar');
 const release=await sign(vault,jar,join(stage,'release-aligned.apk'),join(stage,'po-puti-release.apk'),key.certificateSHA256);
 await sign(vault,jar,join(stage,'test-aligned.apk'),join(stage,'signed-test.apk'),key.certificateSHA256);
 const metadata={package:'ru.poputi.app',versionCode,versionName,sourceSha,certificateSHA256:key.certificateSHA256,...release};
 await writeFile(join(stage,'release-info.json'),JSON.stringify(metadata,null,2)+'\n',{mode:0o600,flag:'wx'});
 await copyFile(join(vault,files.certificate),join(stage,'certificate.pem'),constants.COPYFILE_EXCL);
 return metadata;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  process.umask(0o077);
  if(process.getuid()!==0)throw Error('The production signing vault requires root on the VPS');
  const [command,stage,code,name,sha]=process.argv.slice(2);
  if(command!=='sign'||!/^\/var\/lib\/po-puti-android-builds\/run-[0-9]+-[0-9]+$/.test(stage||'')||resolve(stage)!==stage)throw Error('Unexpected signing command or stage');
  const metadata=await signStage(stage,{versionCode:Number(code),versionName:name,sourceSha:sha});
  console.log('ANDROID_RELEASE_SIGNED '+JSON.stringify(metadata));
 }catch(error){console.error('ANDROID_RELEASE_SIGNING_FAILED: '+error.message);process.exitCode=1}
}

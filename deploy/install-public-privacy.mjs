// Public operator/contact arrive as JSON via pinned SSH stdin. Only these two
// settings are changed; service terms, ads, credentials and user data stay intact.
import {readFile,mkdir,mkdtemp,writeFile,rename,chmod,chown,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function privacyPayload(value){
 const operator=String(value.operator||'').trim(),contactEmail=String(value.contactEmail||'').trim();
 if(operator.length<3||operator.length>180||/[\u0000-\u001f\u007f]/.test(operator))throw Error('Invalid public operator');
 if(contactEmail.length>254||!(/^[^\s@<>"\\]+@[^\s@<>"\\]+\.[^\s@<>"\\]+$/).test(contactEmail))throw Error('Invalid public contact email');
 return {operator,contactEmail};
}
const optional=async path=>{try{return await readFile(path)}catch(error){if(error.code==='ENOENT')return null;throw error}};
export async function installPrivacySettings(payload,{configDir='/etc/po-puti',dropinDir='/etc/systemd/system/po-puti.service.d',backupRoot='/var/backups/po-puti',secure=async(path,isDir=false)=>{const gid=Number(execFileSync('id',['-g','poputi'],{encoding:'utf8'}).trim());await chown(path,0,gid);await chmod(path,isDir?0o750:0o640)},restart=async()=>{execFileSync('systemctl',['daemon-reload'],{stdio:'ignore'});execFileSync('systemctl',['restart','po-puti'],{stdio:'ignore'})},healthy=async(data)=>{for(let attempt=0;attempt<15;attempt++){try{const r=await fetch('http://127.0.0.1:8080/api/health',{signal:AbortSignal.timeout(3000)});if(r.ok&&(await r.json()).ok===true){const c=await fetch('http://127.0.0.1:8080/api/public-config',{signal:AbortSignal.timeout(3000)});const v=await c.json();if(c.ok&&v.privacy?.operator===data.operator&&v.privacy?.contact===data.contactEmail)return true}}catch{}await new Promise(resolve=>setTimeout(resolve,1000))}return false}}={}){
 const data=privacyPayload(payload);
 await mkdir(configDir,{recursive:true,mode:0o750});await mkdir(dropinDir,{recursive:true,mode:0o755});await mkdir(backupRoot,{recursive:true,mode:0o700});
 await secure(configDir,true);
 const envPath=join(configDir,'privacy.env'),dropinPath=join(dropinDir,'47-privacy.conf');
 for(const path of [envPath,dropinPath]){try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe Public privacy settings path')}catch(error){if(error.code!=='ENOENT')throw error}}
 const oldEnv=await optional(envPath),oldDropin=await optional(dropinPath);
 if(oldEnv&&Object.keys(parseEnv(oldEnv.toString())).some(name=>!['PRIVACY_OPERATOR','PRIVACY_CONTACT'].includes(name)))throw Error('Dedicated privacy.env contains unrelated settings; refusing to overwrite');
 const expectedDropin='[Service]\nEnvironmentFile='+envPath+'\n';
 if(oldDropin&&oldDropin.toString().trim()!==expectedDropin.trim())throw Error('Existing Public privacy drop-in contains custom directives; refusing to overwrite');
 const backup=await mkdtemp(join(backupRoot,'privacy-settings-'));await chmod(backup,0o700);
 if(oldEnv)await writeFile(join(backup,'privacy.env'),oldEnv,{mode:0o600});if(oldDropin)await writeFile(join(backup,'47-privacy.conf'),oldDropin,{mode:0o600});
 const staging=await mkdtemp(join(configDir,'.privacy-'));
 async function atomic(path,bytes,isPrivate){const next=join(staging,isPrivate?'env':'dropin');await writeFile(next,bytes,{mode:isPrivate?0o600:0o644});if(isPrivate)await secure(next);await rename(next,path)}
 try{
  await atomic(envPath,`PRIVACY_OPERATOR=${JSON.stringify(data.operator)}\nPRIVACY_CONTACT=${JSON.stringify(data.contactEmail)}\n`,true);
  await atomic(dropinPath,expectedDropin,false);
  await restart();if(!await healthy(data))throw Error('Public privacy activation health failed');
  return {ok:true};
 }catch{
  try{if(oldEnv)await atomic(envPath,oldEnv,true);else await rm(envPath,{force:true});if(oldDropin)await atomic(dropinPath,oldDropin,false);else await rm(dropinPath,{force:true});await restart()}catch{throw Error('Public privacy rollback requires operator attention; private backup retained')}
  throw Error('Public privacy activation failed; previous settings restored');
 }finally{await rm(staging,{recursive:true,force:true})}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.getuid()!==0)throw Error('Privileged installer required');
  let bytes=0,parts=[];for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>4096)throw Error('Oversized settings payload');parts.push(chunk)}
  const result=await installPrivacySettings(JSON.parse(Buffer.concat(parts).toString('utf8')));console.log('PUBLIC_PRIVACY_INSTALLED',JSON.stringify(result));
 }catch{console.error('PUBLIC_PRIVACY_INSTALL_FAILED: settings were not activated; inspect protected backup/service status');process.exitCode=1}
}

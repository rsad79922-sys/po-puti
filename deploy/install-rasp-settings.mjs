// Private JSON arrives on stdin over pinned SSH, never in argv or a shell script.
import {readFile,mkdir,mkdtemp,writeFile,rename,chmod,chown,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function raspPayload(env){
 const key=env.YANDEX_RASP_API_KEY||'',dailyLimit=Number(env.RASP_DAILY_LIMIT||450),cacheSeconds=Number(env.RASP_CACHE_SECONDS||1800);
 if(!/^[A-Za-z0-9_-]{10,200}$/.test(key))throw Error('Invalid or missing private Timetables key');
 if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>450||!Number.isInteger(cacheSeconds)||cacheSeconds<1||cacheSeconds>3600)throw Error('Unsafe Timetables quota/cache settings');
 return {key,dailyLimit,cacheSeconds};
}
const optional=async path=>{try{return await readFile(path)}catch(error){if(error.code==='ENOENT')return null;throw error}};
export async function installRaspSettings(payload,{configDir='/etc/po-puti',dropinDir='/etc/systemd/system/po-puti.service.d',backupRoot='/var/backups/po-puti',secure=async(path,isDir=false)=>{const gid=Number(execFileSync('id',['-g','poputi'],{encoding:'utf8'}).trim());await chown(path,0,gid);await chmod(path,isDir?0o750:0o640)},restart=async()=>{execFileSync('systemctl',['daemon-reload'],{stdio:'ignore'});execFileSync('systemctl',['restart','po-puti'],{stdio:'ignore'})},healthy=async()=>{for(let attempt=0;attempt<15;attempt++){try{const r=await fetch('http://127.0.0.1:8080/api/health',{signal:AbortSignal.timeout(3000)});if(r.ok&&(await r.json()).ok===true)return true}catch{}await new Promise(resolve=>setTimeout(resolve,1000))}return false}}={}){
 const data=raspPayload({YANDEX_RASP_API_KEY:payload.key,RASP_DAILY_LIMIT:payload.dailyLimit,RASP_CACHE_SECONDS:payload.cacheSeconds});
 await mkdir(configDir,{recursive:true,mode:0o750});await mkdir(dropinDir,{recursive:true,mode:0o755});await mkdir(backupRoot,{recursive:true,mode:0o700});
 await secure(configDir,true);
 const envPath=join(configDir,'rasp.env'),dropinPath=join(dropinDir,'50-rasp.conf');
 for(const path of [envPath,dropinPath]){try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe Timetables settings path')}catch(error){if(error.code!=='ENOENT')throw error}}
 const oldEnv=await optional(envPath),oldDropin=await optional(dropinPath);
 if(oldEnv&&Object.keys(parseEnv(oldEnv.toString())).some(name=>!['YANDEX_RASP_API_KEY','RASP_LICENSE_CONFIRMED','RASP_DAILY_LIMIT','RASP_CACHE_SECONDS'].includes(name)))throw Error('Dedicated rasp.env contains unrelated settings; refusing to overwrite');
 const expectedDropin='[Service]\nEnvironmentFile='+envPath+'\n';
 if(oldDropin&&oldDropin.toString().trim()!==expectedDropin.trim())throw Error('Existing Timetables drop-in contains custom directives; refusing to overwrite');
 const backup=await mkdtemp(join(backupRoot,'rasp-settings-'));await chmod(backup,0o700);
 if(oldEnv)await writeFile(join(backup,'rasp.env'),oldEnv,{mode:0o600});if(oldDropin)await writeFile(join(backup,'50-rasp.conf'),oldDropin,{mode:0o600});
 const staging=await mkdtemp(join(configDir,'.rasp-'));
 async function atomic(path,bytes,isPrivate){const next=join(staging,isPrivate?'env':'dropin');await writeFile(next,bytes,{mode:isPrivate?0o600:0o644});if(isPrivate)await secure(next);await rename(next,path)}
 try{
  await atomic(envPath,`YANDEX_RASP_API_KEY=${data.key}\nRASP_LICENSE_CONFIRMED=true\nRASP_DAILY_LIMIT=${data.dailyLimit}\nRASP_CACHE_SECONDS=${data.cacheSeconds}\n`,true);
  await atomic(dropinPath,expectedDropin,false);
  await restart();if(!await healthy())throw Error('Timetables activation health failed');
  return {ok:true,dailyLimit:data.dailyLimit,cacheSeconds:data.cacheSeconds};
 }catch{
  try{if(oldEnv)await atomic(envPath,oldEnv,true);else await rm(envPath,{force:true});if(oldDropin)await atomic(dropinPath,oldDropin,false);else await rm(dropinPath,{force:true});await restart()}catch{throw Error('Timetables rollback requires operator attention; private backup retained')}
  throw Error('Timetables activation failed; previous settings restored');
 }finally{await rm(staging,{recursive:true,force:true})}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.getuid()!==0)throw Error('Privileged installer required');
  let bytes=0,parts=[];for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>4096)throw Error('Oversized settings payload');parts.push(chunk)}
  const result=await installRaspSettings(JSON.parse(Buffer.concat(parts).toString('utf8')));console.log('RASP_INSTALLED',JSON.stringify(result));
 }catch{console.error('RASP_INSTALL_FAILED: settings were not activated; inspect protected backup/service status');process.exitCode=1}
}

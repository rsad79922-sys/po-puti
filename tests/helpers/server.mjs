import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export async function isolatedServer(extra={}){
 const dir=await mkdtemp(join(tmpdir(),'po-puti-security-'));
 const child=spawn(process.execPath,['server/server.mjs'],{env:{...process.env,DATA_DIR:dir,HOST:'127.0.0.1',PORT:'0',ADMIN_USERNAME:'',ADMIN_PASSWORD:'',PUBLIC_ORIGIN:'',...extra},stdio:['ignore','pipe','pipe']});
 let output='';child.stderr.on('data',c=>output+=c);
 const stop=async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}await rm(dir,{recursive:true,force:true})};
 try{
  const base=await new Promise((resolve,reject)=>{
   const t=setTimeout(()=>reject(Error('Server timeout: '+output)),10000);
   child.once('exit',()=>{clearTimeout(t);reject(Error('Server exited: '+output))});
   child.stdout.on('data',c=>{const match=String(c).match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(t);resolve(match[0])}});
  });
  return {base,dir,child,stop};
 }catch(error){await stop();throw error}
}

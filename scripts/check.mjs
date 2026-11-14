import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
for(const dir of ['www','server','scripts','tests','deploy']){
 for(const name of await readdir(dir)){
  const path=dir+'/'+name;
  const args=/\.(?:mjs|js)$/.test(name)?[process.execPath,['--check',path]]:name.endsWith('.sh')?['bash',['-n',path]]:null;
  if(args){const r=spawnSync(...args,{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1)}
 }
}
console.log('JavaScript and shell syntax OK');

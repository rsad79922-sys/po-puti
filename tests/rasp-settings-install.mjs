import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,chmod,readdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {raspPayload,installRaspSettings} from '../deploy/install-rasp-settings.mjs';
const dir=await mkdtemp(join(tmpdir(),'poputi-rasp-settings-')),configDir=join(dir,'etc'),dropinDir=join(dir,'units'),backupRoot=join(dir,'backups');
const key='fixture-private-key-abcdefghijklmnopqrstuvwxyz';let restarts=0;
const options={configDir,dropinDir,backupRoot,secure:async(path,isDir)=>chmod(path,isDir?0o750:0o640),restart:async()=>{restarts++},healthy:async()=>true};
try{
 assert.throws(()=>raspPayload({YANDEX_RASP_API_KEY:key,RASP_DAILY_LIMIT:451}));assert.throws(()=>raspPayload({YANDEX_RASP_API_KEY:key,RASP_CACHE_SECONDS:3601}));
 const payload=raspPayload({YANDEX_RASP_API_KEY:key});assert.equal(payload.dailyLimit,450);assert.equal(payload.cacheSeconds,1800);
 const result=await installRaspSettings(payload,options);assert(!JSON.stringify(result).includes(key));assert.equal(restarts,1);
 const env=await readFile(join(configDir,'rasp.env'),'utf8'),dropin=await readFile(join(dropinDir,'50-rasp.conf'),'utf8');assert(env.includes(key));assert(env.includes('RASP_LICENSE_CONFIRMED=true'));assert.equal((await stat(join(configDir,'rasp.env'))).mode&0o777,0o640);
 const unrelated=join(configDir,'routing.env');await writeFile(unrelated,'DO_NOT_CHANGE=fixture\n');
 await assert.rejects(installRaspSettings({...payload,key:'replacement-key-abcdefghijklmnopqrstuvwxyz'},{...options,healthy:async()=>false}),/previous settings restored/);assert.equal(await readFile(join(configDir,'rasp.env'),'utf8'),env);assert.equal(await readFile(join(dropinDir,'50-rasp.conf'),'utf8'),dropin);assert.equal(await readFile(unrelated,'utf8'),'DO_NOT_CHANGE=fixture\n');
 for(const name of await readdir(backupRoot))assert.equal((await stat(join(backupRoot,name))).mode&0o777,0o700);
 await rm(join(configDir,'rasp.env'));await symlink(unrelated,join(configDir,'rasp.env'));await assert.rejects(installRaspSettings(payload,options),/Unsafe/);assert.equal(await readFile(unrelated,'utf8'),'DO_NOT_CHANGE=fixture\n');
 const serialized=spawnSync(process.execPath,['scripts/rasp-settings-payload.mjs'],{env:{...process.env,YANDEX_RASP_API_KEY:key},encoding:'utf8'});assert.equal(serialized.status,0);assert.equal(JSON.parse(serialized.stdout).key,key);assert.equal(serialized.stderr,'');
 const bad=spawnSync(process.execPath,['scripts/rasp-settings-payload.mjs'],{env:{...process.env,YANDEX_RASP_API_KEY:key,RASP_DAILY_LIMIT:'999'},encoding:'utf8'});assert.notEqual(bad.status,0);assert(!bad.stdout.includes(key));assert(!bad.stderr.includes(key));
 console.log('PASS: bounded free Rasps settings, private atomic install, health-failure rollback, unrelated-file and symlink protection, secret through stdin payload only');
}finally{await rm(dir,{recursive:true,force:true})}

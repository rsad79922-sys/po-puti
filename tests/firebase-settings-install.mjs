import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

// Run the actual shell installer against private temporary paths and fake OS/provider
// commands. Never restart the host service, access /etc or contact Firebase.
const root=await mkdtemp(join(tmpdir(),'poputi-firebase-install-'));
try{
 for(const name of ['etc','backups','units','bin'])await mkdir(join(root,name));
 const input=join(root,'input.json');await writeFile(input,'{}',{mode:0o600});
 const original=await readFile(new URL('../deploy/configure-firebase-push.sh',import.meta.url),'utf8');
 const script=original.replaceAll(' -o root -g poputi','').replace('cd /opt/po-puti','cd "$FIXTURE_ROOT"').replaceAll('/etc/po-puti',root+'/etc').replaceAll('/var/backups',root+'/backups').replaceAll('/etc/systemd/system/po-puti.service.d',root+'/units');
 const installer=join(root,'install.sh');await writeFile(installer,script);
 const mocks={id:'echo 0',chown:':',systemctl:':',sleep:':',curl:'if [ "$FIXTURE_HEALTH" = ok ];then echo \'{"ok":true}\';else exit 1;fi',node:'if [ "$FIXTURE_VALIDATE" != ok ];then exit 1;fi; printf \'private-fixture-account\' > "$3/service-account.json";printf \'public-fixture-client\' > "$3/android-client.json";printf \'FCM_PROJECT_ID=fixture-project\\n\' > "$3/firebase.env"'};
 for(const [name,body] of Object.entries(mocks)){const path=join(root,'bin',name);await writeFile(path,'#!/bin/sh\nset -eu\n'+body+'\n');await chmod(path,0o700);}
 const run=(health='ok',validate='ok')=>spawnSync('bash',[installer,input],{encoding:'utf8',env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,FIXTURE_ROOT:root,FIXTURE_HEALTH:health,FIXTURE_VALIDATE:validate}});
 await writeFile(join(root,'etc','push.env'),'EXISTING_VAPID=keep\n');await writeFile(join(root,'etc','routing.env'),'EXISTING_GEOCODER=keep\n');
 let result=run();assert.equal(result.status,0,result.stderr);assert(!result.stdout.includes('private-fixture-account'));
 const target=join(root,'etc','firebase-push'),env=await readFile(join(target,'firebase.env'),'utf8'),dropin=await readFile(join(root,'units','46-firebase-push.conf'),'utf8');
 assert.equal((await stat(target)).mode&0o777,0o750);assert.equal((await stat(join(target,'service-account.json'))).mode&0o777,0o640);
 result=run('failed');assert.notEqual(result.status,0);assert.equal(await readFile(join(target,'firebase.env'),'utf8'),env);assert.equal(await readFile(join(root,'units','46-firebase-push.conf'),'utf8'),dropin);
 result=run('ok','failed');assert.notEqual(result.status,0);assert.equal(await readFile(join(target,'firebase.env'),'utf8'),env);
 assert.equal(await readFile(join(root,'etc','push.env'),'utf8'),'EXISTING_VAPID=keep\n');assert.equal(await readFile(join(root,'etc','routing.env'),'utf8'),'EXISTING_GEOCODER=keep\n');
 for(const name of await readdir(join(root,'backups')))assert.equal((await stat(join(root,'backups',name))).mode&0o777,0o700);
 console.log('PASS: actual Firebase shell installer preserves unrelated settings, private modes/backups, validation before mutation and rollback after failed health (isolated OS/provider fixtures)');
}finally{await rm(root,{recursive:true,force:true})}

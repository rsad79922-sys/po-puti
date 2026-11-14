import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile,stat,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
const dir=await mkdtemp(join(tmpdir(),'po-puti-ssh-pin-'));
try{
 const key=join(dir,'host');
 let r=spawnSync('ssh-keygen',['-q','-t','rsa','-b','2048','-N','','-f',key]);assert.equal(r.status,0);
 const fingerprint=spawnSync('ssh-keygen',['-lf',key+'.pub','-E','sha256'],{encoding:'utf8'}).stdout.split(' ')[1];
 const pin=join(dir,'pin');await writeFile(pin,fingerprint+'\n');
 const bin=join(dir,'bin');await mkdir(bin);
 await writeFile(join(bin,'ssh-keyscan'),'#!/bin/sh\nprintf "test-host "\ncat "$MOCK_PUBLIC_KEY"\n',{mode:0o700});
 const env={...process.env,PATH:bin+':'+process.env.PATH,DEPLOY_HOST:'test-host',DEPLOY_KEY:'test-private-fixture',MOCK_PUBLIC_KEY:key+'.pub'};
 const out=join(dir,'verified');r=spawnSync('bash',['deploy/prepare-ssh.sh',out,pin],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/SSH_HOST_PIN_VERIFIED/);assert.equal((await stat(out+'/key')).mode&0o077,0);
 assert.match(await readFile(out+'/known_hosts','utf8'),/^test-host ssh-rsa /);
 await writeFile(pin,'SHA256:'+'A'.repeat(43)+'\n');const refused=join(dir,'refused');
 r=spawnSync('bash',['deploy/prepare-ssh.sh',refused,pin],{env,encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/fingerprint mismatch/);
 await assert.rejects(stat(refused+'/known_hosts'));
 console.log('PASS: owner-verified SSH fingerprint accepted, changed key refused, private runner files');
}finally{await rm(dir,{recursive:true,force:true})}

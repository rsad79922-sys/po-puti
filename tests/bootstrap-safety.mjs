import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const dir=await mkdtemp(join(tmpdir(),'po-puti-bootstrap-'));
try{
 const app=join(dir,'app'),data=join(dir,'data'),bin=join(dir,'bin');
 for(const p of [app,data,bin])await mkdir(p);
 const dbPath=join(data,'po-puti.sqlite');const db=new DatabaseSync(dbPath);db.exec("CREATE TABLE users(id TEXT);INSERT INTO users VALUES('existing-user')");db.close();
 await writeFile(join(data,'photo.jpg'),'existing-photo');
 const aptMarker=join(dir,'apt-called');
 await writeFile(join(bin,'id'),'#!/bin/sh\necho 0\n',{mode:0o700});
 await writeFile(join(bin,'apt-get'),'#!/bin/sh\ntouch "$APT_TEST_MARKER"\nexit 93\n',{mode:0o700});
 const source=await readFile('deploy/bootstrap-vps.sh','utf8');
 const path=join(dir,'bootstrap.sh');
 await writeFile(path,source.replace('APP=/opt/po-puti','APP='+app).replace('DATA=/var/lib/po-puti','DATA='+data).replace('/run/lock/po-puti-deploy.lock',join(dir,'lock')));
 const env={...process.env,PATH:bin+':'+process.env.PATH,APT_TEST_MARKER:aptMarker};
 let result=spawnSync('bash',[path,'invalid'],{env,encoding:'utf8'});assert.equal(result.status,2);assert.match(result.stderr,/Invalid commit/);
 result=spawnSync('bash',[path,'a'.repeat(40)],{env,encoding:'utf8'});assert.equal(result.status,2);assert.match(result.stderr,/Application path exists/);
 await assert.rejects(stat(aptMarker),'existing installation must be refused before package changes');
 await rm(app,{recursive:true});
 result=spawnSync('bash',[path,'a'.repeat(40)],{env,encoding:'utf8'});assert.equal(result.status,93,'package failure must stop installation');
 const check=new DatabaseSync(dbPath,{readOnly:true});assert.equal(check.prepare('SELECT id FROM users').get().id,'existing-user');check.close();
 assert.equal(await readFile(join(data,'photo.jpg'),'utf8'),'existing-photo');
 console.log('PASS: initial install refuses existing checkout/invalid SHA; package failure preserves database and photos');
}finally{await rm(dir,{recursive:true,force:true})}

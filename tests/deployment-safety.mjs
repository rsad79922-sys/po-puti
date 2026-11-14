// Exercise the real release control flow with fake systemctl/curl and a temporary
// repository/database. No live filesystem paths, network or services are used.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const root=await mkdtemp(join(tmpdir(),'po-puti-deploy-test-'));
const realNode=process.execPath;
const run=(cmd,args,cwd=root,env={})=>{
 const result=spawnSync(cmd,args,{cwd,env:{...process.env,...env},encoding:'utf8'});
 if(result.status!==0)throw Error(`${cmd} failed: ${result.stderr}\n${result.stdout}`);
 return result.stdout.trim();
};
try{
 const origin=join(root,'origin.git'),app=join(root,'app'),data=join(root,'data'),bin=join(root,'bin'),backups=join(root,'backups');
 await mkdir(data);await mkdir(bin);
 run('git',['init','--bare',origin]);run('git',['clone',origin,app]);
 run('git',['config','user.name','Deployment test'],app);run('git',['config','user.email','test@example.invalid'],app);
 run('git',['switch','-c','main'],app);
 for(const path of ['scripts','server','www'])await mkdir(join(app,path));
 for(const file of ['scripts/check.mjs','scripts/test.mjs','scripts/build.mjs','server/server.mjs'])await writeFile(join(app,file),'// verified fixture\n');
 await writeFile(join(app,'www/index.html'),'<html>old</html>');
 run('git',['add','.'],app);run('git',['commit','-m','baseline'],app);run('git',['push','origin','main'],app);
 const previous=run('git',['rev-parse','HEAD'],app);
 await writeFile(join(app,'www/index.html'),'<html>new</html>');run('git',['commit','-am','candidate'],app);run('git',['push','origin','main'],app);
 const candidate=run('git',['rev-parse','HEAD'],app);run('git',['reset','--hard',previous],app);
 const db=new DatabaseSync(join(data,'po-puti.sqlite'));
 db.exec("CREATE TABLE users(id TEXT);CREATE TABLE rides(id TEXT);INSERT INTO users VALUES('preserve-me');INSERT INTO rides VALUES('ride');");db.close();
 await mkdir(join(data,'uploads'));await writeFile(join(data,'uploads/photo.jpg'),'preserve-photo');
 const log=join(root,'systemctl.log');
 const stubs={
  id:'#!/bin/sh\necho 0\n',
  systemctl:'#!/bin/sh\necho "$*" >> "$DEPLOY_TEST_LOG"\nexit 0\n',
  sleep:'#!/bin/sh\nexit 0\n',
  curl:'#!/bin/sh\ncase "$*" in *https:*) [ "$DEPLOY_TEST_MODE" != "rollback" ] || exit 22;; esac\nprintf \'{"ok":true,"release":"%s"}\\n\' "$DEPLOY_TEST_SHA"\n',
  node:`#!/bin/sh\nif [ "$DEPLOY_TEST_MODE" = preflight ] && [ "$1" = scripts/test.mjs ]; then exit 1; fi\nexec '${realNode}' "$@"\n`
 };
 for(const [name,source] of Object.entries(stubs))await writeFile(join(bin,name),source,{mode:0o755});
 const source=await readFile(new URL('../deploy/release-on-vps.sh',import.meta.url),'utf8');
 const script=source.replaceAll('/opt/po-puti',app).replaceAll('/var/lib/po-puti-release.env',join(root,'release.env')).replaceAll('/var/lib/po-puti',data).replaceAll('/var/backups/po-puti',backups).replaceAll('/run/lock/po-puti-deploy.lock',join(root,'deploy.lock'));
 const scriptPath=join(root,'release.sh');await writeFile(scriptPath,script);
 const env={...process.env,PATH:bin+':'+process.env.PATH,DEPLOY_TEST_LOG:log,DEPLOY_TEST_SHA:candidate};
 let result=spawnSync('bash',[scriptPath,candidate],{env:{...env,DEPLOY_TEST_MODE:'preflight'},encoding:'utf8'});
 assert.notEqual(result.status,0);assert(!((await readFile(log,'utf8')).includes('stop')),'failed tests must never stop service');
 assert.equal(run('git',['rev-parse','HEAD'],app),previous);
 result=spawnSync('bash',[scriptPath,candidate],{env:{...env,DEPLOY_TEST_MODE:'rollback'},encoding:'utf8'});
 assert.notEqual(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/Release failed, restoring/);
 assert.equal(run('git',['rev-parse','HEAD'],app),previous,'failed health rolls back code');
 // Retry with different timestamp-derived backup names; never overwrite an old backup.
 for(const entry of await readdir(backups))assert((await readFile(join(backups,entry))).length>0);
 const check=new DatabaseSync(join(data,'po-puti.sqlite'),{readOnly:true});assert.equal(check.prepare('SELECT id FROM users').get().id,'preserve-me');check.close();
 assert.equal(await readFile(join(data,'uploads/photo.jpg'),'utf8'),'preserve-photo');
 // Exercise successful path in a fresh backup directory, without deleting backups.
 await writeFile(scriptPath,script.replaceAll(backups,join(root,'success-backups')));
 result=spawnSync('bash',[scriptPath,candidate],{env:{...env,DEPLOY_TEST_MODE:'success'},encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/RELEASE_OK/);
 assert.equal(run('git',['rev-parse','HEAD'],app),candidate);
 assert((await stat(join(app,'www/index.html'))).mode&0o004,'updated runtime source must remain readable by the service user');
 console.log('PASS: deployment refuses failed preflight; failed HTTPS rolls back code; success installs exact SHA; database and photos preserved');
}finally{await rm(root,{recursive:true,force:true})}

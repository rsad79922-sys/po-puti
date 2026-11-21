import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,stat,readdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {privacyPayload,installPrivacySettings} from '../deploy/install-public-privacy.mjs';
import {renderPrivacyDocument,clientConfig} from '../server/client-config.mjs';
import {isolatedServer} from './helpers/server.mjs';
const folder=await mkdtemp(join(tmpdir(),'poputi-public-privacy-'));
const configDir=join(folder,'etc'),dropinDir=join(folder,'units'),backupRoot=join(folder,'backups');
let restarts=0;
const options={configDir,dropinDir,backupRoot,secure:async(path,isDir)=>chmod(path,isDir?0o750:0o640),restart:async()=>{restarts++},healthy:async(data)=>data.operator==='Тестовый Оператор'&&data.contactEmail==='fixture@example.invalid'};
try{
 const template='<p id="privacy-owner">not configured</p>';
 assert.equal(renderPrivacyDocument(template,{}),template);
 const rendered=renderPrivacyDocument(template,{PRIVACY_OPERATOR:'<img src=x onerror=alert(1)>',PRIVACY_CONTACT:'x&y@example.invalid'});
 assert(!rendered.includes('<img'));assert(rendered.includes('&lt;img'));assert(rendered.includes('x&amp;y@example.invalid'));
 const policy=await readFile(new URL('../www/privacy.html',import.meta.url),'utf8');assert(policy.includes(clientConfig({}).privacy.policyVersion),'policy API version must match the published document');
 const server=await isolatedServer({PRIVACY_OPERATOR:'Тестовый Оператор',PRIVACY_CONTACT:'fixture@example.invalid'});
 try{
  const response=await fetch(server.base+'/privacy.html');const html=await response.text();assert.equal(response.status,200);assert(html.includes('Тестовый Оператор. Контакт: fixture@example.invalid'));
  assert.equal(Number(response.headers.get('content-length')),Buffer.byteLength(html));assert.equal(response.headers.get('cache-control'),'no-store');
  const head=await fetch(server.base+'/privacy.html',{method:'HEAD'});assert.equal(Number(head.headers.get('content-length')),Buffer.byteLength(html));assert.equal(await head.text(),'');
 }finally{await server.stop()}
 for(const data of [{},{operator:'x',contactEmail:'a@b.invalid'},{operator:'Name\nINJECT=true',contactEmail:'a@b.invalid'},{operator:'Person',contactEmail:'a@b.invalid\nINJECT=true'},{operator:'Person',contactEmail:'invalid'}])assert.throws(()=>privacyPayload(data));
 const data=privacyPayload({operator:'  Тестовый Оператор  ',contactEmail:'fixture@example.invalid',approved:true});
 assert.deepEqual(Object.keys(data).sort(),['contactEmail','operator']);
 await mkdir(configDir);await writeFile(join(configDir,'po-puti.env'),'KEEP_PRIVATE_SETTINGS=fixture\nPRIVACY_POLICY_APPROVED=false\n');await writeFile(join(configDir,'routing.env'),'KEEP_GEOCODER=fixture\n');
 const result=await installPrivacySettings(data,options);assert.deepEqual(result,{ok:true});assert.equal(restarts,1);
 const envPath=join(configDir,'privacy.env'),unitPath=join(dropinDir,'47-privacy.conf'),env=await readFile(envPath,'utf8'),unit=await readFile(unitPath,'utf8');
 assert.deepEqual({...parseEnv(env)},{PRIVACY_OPERATOR:'Тестовый Оператор',PRIVACY_CONTACT:'fixture@example.invalid'});
 assert.equal((await stat(envPath)).mode&0o777,0o640);assert(!env.includes('PRIVACY_POLICY_APPROVED'));assert(!env.includes('ADS_'));
 await assert.rejects(installPrivacySettings({...data,operator:'Replacement Person'},{...options,healthy:async()=>false}),/previous settings restored/);
 assert.equal(await readFile(envPath,'utf8'),env);assert.equal(await readFile(unitPath,'utf8'),unit);
 assert.equal(await readFile(join(configDir,'po-puti.env'),'utf8'),'KEEP_PRIVATE_SETTINGS=fixture\nPRIVACY_POLICY_APPROVED=false\n');assert.equal(await readFile(join(configDir,'routing.env'),'utf8'),'KEEP_GEOCODER=fixture\n');
 for(const name of await readdir(backupRoot))assert.equal((await stat(join(backupRoot,name))).mode&0o777,0o700);
 await writeFile(unitPath,'[Service]\nCUSTOM=must-stay\n');await assert.rejects(installPrivacySettings(data,options),/custom directives/);await writeFile(unitPath,unit);
 await rm(envPath);await symlink(join(configDir,'po-puti.env'),envPath);await assert.rejects(installPrivacySettings(data,options),/Unsafe/);
 assert.equal(await readFile(join(configDir,'po-puti.env'),'utf8'),'KEEP_PRIVATE_SETTINGS=fixture\nPRIVACY_POLICY_APPROVED=false\n');
 console.log('PASS: public operator/contact validation, no implicit terms approval, private backup/permissions, health rollback, unrelated configuration preservation and symlink refusal');
}finally{await rm(folder,{recursive:true,force:true})}

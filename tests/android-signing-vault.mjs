import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,chmod,lstat,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareVault,backupVault,sha256,signStage} from '../scripts/android-signing-vault.mjs';
const root=await mkdtemp(join(tmpdir(),'poputi-signing-test-'));
try{
 const vault=join(root,'vault'),backup=join(root,'backup');
 const first=await prepareVault(vault,{keySize:2048}),keyHash=await sha256(join(vault,'po-puti-release.p12')),password=await readFile(join(vault,'store-password'),'utf8');
 assert.equal(first.created,true);assert.match(first.certificateSHA256,/^[a-f0-9]{64}$/);assert(!JSON.stringify(first).includes(password.trim()));
 assert.equal((await lstat(vault)).mode&0o777,0o700);
 for(const name of ['po-puti-release.p12','store-password','certificate.pem'])assert.equal((await lstat(join(vault,name))).mode&0o777,0o600);
 const second=await prepareVault(vault,{keySize:2048});assert.equal(second.created,false);assert.equal(second.certificateSHA256,first.certificateSHA256);assert.equal(await sha256(join(vault,'po-puti-release.p12')),keyHash,'permanent key must never rotate on repeated builds');
 const saved=await backupVault(vault,backup);assert.equal(await sha256(saved.keyBackup),keyHash);assert.equal((await lstat(saved.keyBackup)).mode&0o777,0o600);await backupVault(vault,backup);
 await writeFile(saved.keyBackup,'corrupted test backup');await assert.rejects(()=>backupVault(vault,backup),/not overwritten/);assert.equal(await readFile(saved.keyBackup,'utf8'),'corrupted test backup');
 await chmod(join(vault,'store-password'),0o644);await assert.rejects(()=>prepareVault(vault),/unsafe ownership\/permissions/);await chmod(join(vault,'store-password'),0o600);
 const partial=join(root,'partial');await mkdir(partial,{mode:0o700});await writeFile(join(partial,'po-puti-release.p12'),'do not overwrite',{mode:0o600});await assert.rejects(()=>prepareVault(partial),/Incomplete/);assert.equal(await readFile(join(partial,'po-puti-release.p12'),'utf8'),'do not overwrite');
 await symlink(vault,join(root,'linked'));await assert.rejects(()=>prepareVault(join(root,'linked')),/trusted user/);
 const stage=join(root,'stage');await mkdir(stage,{mode:0o700});
 await assert.rejects(()=>signStage(stage,{versionCode:3,versionName:'1.0.0',sourceSha:'a'.repeat(40)}),/RuStore version 3/);
 assert.equal(await sha256(join(vault,'po-puti-release.p12')),keyHash);
 console.log('PASS: permanent encrypted PKCS12 key, password file permissions, stable certificate across builds, separate key backup, no password in metadata, partial-vault/symlink refusal and RuStore version floor');
}finally{await rm(root,{recursive:true,force:true})}

import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseApkMetadata} from '../scripts/inspect-android-apk.mjs';

const cert='a'.repeat(64),second='b'.repeat(64);
const badging="package: versionName='2.0 candidate' name='ru.poputi.app' versionCode='17' platformBuildVersionName='15'\n";
const verification='Verifies\nNumber of signers: 1\nSigner #1 certificate SHA-256 digest: '+cert+'\n';
const metadata=parseApkMetadata(badging,verification);
assert.equal(metadata.package,'ru.poputi.app');assert.equal(metadata.versionCode,17);assert.equal(metadata.versionName,'2.0 candidate');assert.equal(metadata.debuggable,false);assert.equal(metadata.certificateSHA256,cert);
assert.equal(parseApkMetadata(badging+'application-debuggable\n',verification).debuggable,true,'historical debug APK must be identified, never assumed a release');
const multiple=parseApkMetadata(badging,verification.replace('signers: 1','signers: 2')+'Signer #2 certificate SHA-256 digest: '+second+'\n');assert.equal(multiple.singleSigner,false);assert.equal(multiple.certificateSHA256,null);assert.deepEqual(multiple.signers,[{index:1,certificateSHA256:cert},{index:2,certificateSHA256:second}],'never silently select signer #1 from a multi-signer APK');
for(const invalid of ['',verification.replace(cert,'a'.repeat(63)),verification.replace('signers: 1','signers: 2'),verification.replace('Signer #1','Signer #2'),verification+'Signer #1 certificate SHA-256 digest: '+cert+'\n'])assert.throws(()=>parseApkMetadata(badging,invalid));
assert.throws(()=>parseApkMetadata(badging.replace("versionCode='17'","versionCode='0'"),verification));
assert.throws(()=>parseApkMetadata(badging.replace("versionCode='17'","versionCode='17' versionCode='18'"),verification));
assert.equal(parseApkMetadata(badging.replace("2.0 candidate","name=\\'misleading.package\\'"),verification).package,'ru.poputi.app','quoted version text cannot replace the actual package');

const dir=await mkdtemp(join(tmpdir(),'poputi-apk-inspection-'));
try{
 const aapt=join(dir,'aapt'),signer=join(dir,'apksigner'),apk=join(dir,'submitted.apk'),bytes='isolated APK fixture';
 await writeFile(apk,bytes);
 await writeFile(aapt,'#!/usr/bin/env node\nif(process.env.TEST_AAPT_ERROR){console.error(process.env.PRIVATE_FIXTURE);process.exit(1)}process.stdout.write(process.env.TEST_BADGING);\n',{mode:0o700});
 await writeFile(signer,'#!/usr/bin/env node\nif(process.env.TEST_SIGNATURE_ERROR){console.error(process.env.PRIVATE_FIXTURE);process.exit(1)}process.stdout.write(process.env.TEST_VERIFICATION);\n',{mode:0o700});
 const env={...process.env,AAPT:aapt,APKSIGNER:signer,TEST_BADGING:badging,TEST_VERIFICATION:verification,PRIVATE_FIXTURE:'private-tool-output-must-not-be-logged'};
 const run=extra=>spawnSync(process.execPath,['scripts/inspect-android-apk.mjs',apk],{encoding:'utf8',env:{...env,...extra}});
 const success=run({});assert.equal(success.status,0,success.stderr);const result=JSON.parse(success.stdout);assert.equal(result.apkSHA256,createHash('sha256').update(bytes).digest('hex'));assert.equal(result.bytes,Buffer.byteLength(bytes));
 assert.equal(await readFile(apk,'utf8'),bytes,'inspection must not alter the APK');
 for(const error of [{TEST_SIGNATURE_ERROR:'true'},{TEST_AAPT_ERROR:'true'}]){const result=run(error);assert.notEqual(result.status,0);assert(!result.stderr.includes(env.PRIVATE_FIXTURE));assert.equal(result.stdout,'')}
 const multi=run({TEST_VERIFICATION:verification.replace('signers: 1','signers: 2')+'Signer #2 certificate SHA-256 digest: '+second+'\n'});assert.equal(multi.status,0);assert.equal(JSON.parse(multi.stdout).singleSigner,false);
 console.log('PASS: read-only APK public package/version/debug/certificate inspection, all current signers enumerated, malformed signer metadata rejected, signature failures fail closed and tool error output withheld');
}finally{await rm(dir,{recursive:true,force:true})}

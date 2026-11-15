import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const dir=await mkdtemp(join(tmpdir(),'poputi-release-check-'));
try{
 const aapt=join(dir,'aapt'),signer=join(dir,'apksigner'),apk=join(dir,'candidate.apk'),fingerprint='a'.repeat(64);
 await writeFile(apk,'isolated-fixture');
 await writeFile(aapt,'#!/usr/bin/env node\nprocess.stdout.write(process.env.TEST_BADGING);\n',{mode:0o700});
 await writeFile(signer,'#!/usr/bin/env node\nif(process.env.TEST_UNSIGNED)process.exit(1);process.stdout.write("Signer #1 certificate SHA-256 digest: "+process.env.TEST_CERT);\n',{mode:0o700});
 const env={...process.env,AAPT:aapt,APKSIGNER:signer,ANDROID_PREVIOUS_VERSION_CODE:'4',ANDROID_PREVIOUS_CERT_SHA256:fingerprint,TEST_BADGING:"package: name='ru.poputi.app' versionCode='5' versionName='0.3.0'",TEST_CERT:fingerprint};
 const run=extra=>spawnSync(process.execPath,['scripts/check-android-release.mjs',apk],{env:{...env,...extra},encoding:'utf8'});
 assert.equal(run({}).status,0);
 for(const invalid of [{TEST_BADGING:env.TEST_BADGING+'\napplication-debuggable'},{TEST_BADGING:env.TEST_BADGING.replace("versionCode='5'","versionCode='4'")},{TEST_BADGING:env.TEST_BADGING.replace('ru.poputi.app','different.package')},{TEST_CERT:'b'.repeat(64)},{TEST_UNSIGNED:'true'},{ANDROID_PREVIOUS_CERT_SHA256:''}])assert.notEqual(run(invalid).status,0);
 console.log('PASS: release checker rejects debug, reused versions, changed package/signer, unsigned APK and absent prior publication metadata');
}finally{await rm(dir,{recursive:true,force:true})}

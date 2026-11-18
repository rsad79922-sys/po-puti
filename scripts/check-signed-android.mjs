import {readFile,writeFile} from 'node:fs/promises';
import {inspectApk} from './inspect-android-apk.mjs';
const [apk,metadataPath]=process.argv.slice(2);
const expected=JSON.parse(await readFile(metadataPath,'utf8'));
const actual=await inspectApk(apk);
if(actual.package!=='ru.poputi.app'||actual.debuggable||!actual.singleSigner||actual.versionCode!==Number(process.env.ANDROID_VERSION_CODE)||actual.versionName!==process.env.ANDROID_VERSION_NAME||actual.certificateSHA256!==expected.certificateSHA256||actual.apkSHA256!==expected.apkSHA256||expected.sourceSha!==process.env.GITHUB_SHA)throw Error('Signed direct-release APK identity, version, certificate, digest or source revision mismatch');
await writeFile(metadataPath,JSON.stringify({...actual,sourceSha:expected.sourceSha},null,2)+'\n');
await writeFile('out/SHA256SUMS',actual.apkSHA256+'  po-puti-release.apk\n');
console.log('SIGNED_RELEASE_VERIFIED '+JSON.stringify(actual)); // Public APK/certificate metadata only.

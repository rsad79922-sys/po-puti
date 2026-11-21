import {inspectApk} from './inspect-android-apk.mjs';
const [previousPath,nextPath]=process.argv.slice(2);
const previous=await inspectApk(previousPath),next=await inspectApk(nextPath);
if(previous.package!=='ru.poputi.app'||next.package!==previous.package||previous.certificateSHA256!==next.certificateSHA256||!previous.singleSigner||!next.singleSigner||previous.debuggable||next.debuggable||next.versionCode<=previous.versionCode)throw Error('Existing public APK and candidate are not a compatible upgrade');
console.log('ANDROID_UPGRADE_IDENTITY_OK: '+previous.versionCode+' -> '+next.versionCode+'; same package and permanent signing certificate');

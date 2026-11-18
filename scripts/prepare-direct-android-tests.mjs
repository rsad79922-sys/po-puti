import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
const path='android/app/build.gradle';let gradle=await readFile(path,'utf8');
if(!gradle.includes("testBuildType 'release'"))gradle=gradle.replace('android {',"android {\n    testBuildType 'release'");
await writeFile(path,gradle);
const tests='android/app/src/androidTest/java/ru/poputi/app';await mkdir(tests,{recursive:true});
await copyFile('tests/native-android/SignedReleaseFlowTest.java',tests+'/SignedReleaseFlowTest.java');
await mkdir('android/app/src/test/java/ru/poputi/app',{recursive:true});
await copyFile('tests/native-android/PushPolicyTest.java','android/app/src/test/java/ru/poputi/app/PushPolicyTest.java');
console.log('DIRECT_RELEASE_TESTS_PREPARED: non-debuggable release + separate signed instrumentation APK');

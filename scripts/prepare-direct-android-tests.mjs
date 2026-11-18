import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
const path='android/app/build.gradle';let gradle=await readFile(path,'utf8');
if(!gradle.includes("testBuildType 'release'"))gradle=gradle.replace('android {',"android {\n    testBuildType 'release'");
// The instrumentation class loader can load its desugar library ahead of the
// target app's copy. Keep that test-only library complete so it cannot hide
// methods used by the non-debuggable target (e.g. DesugarCollections.synchronizedMap).
// L8DexDesugarLibTask.keepRulesConfigurations is available in pinned AGP 8.7.2.
if(!gradle.includes('po-puti-release-test-desugar-parity'))gradle+=`
// po-puti-release-test-desugar-parity: affects only the separate test APK.
gradle.projectsEvaluated {
    project.tasks.named('l8DexDesugarLibReleaseAndroidTest').configure { task ->
        task.keepRulesConfigurations.add('-keep class * { *; }')
    }
}
`;
await writeFile(path,gradle);
const tests='android/app/src/androidTest/java/ru/poputi/app';await mkdir(tests,{recursive:true});
await copyFile('tests/native-android/LauncherIconAssertions.java',tests+'/LauncherIconAssertions.java');
await copyFile('tests/native-android/SignedReleaseFlowTest.java',tests+'/SignedReleaseFlowTest.java');
await mkdir('android/app/src/test/java/ru/poputi/app',{recursive:true});
await copyFile('tests/native-android/PushPolicyTest.java','android/app/src/test/java/ru/poputi/app/PushPolicyTest.java');
console.log('DIRECT_RELEASE_TESTS_PREPARED: non-debuggable release + separate signed instrumentation APK');

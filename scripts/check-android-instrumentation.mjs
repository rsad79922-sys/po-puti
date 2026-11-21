import {readFile} from 'node:fs/promises';
const text=await readFile(process.argv[2],'utf8');
const kind=process.argv[3]||'flow';
const labels={flow:'installed non-debuggable release, startup, real production login and native trip search; own QA account anonymized','upgrade-seed':'test-owned previous-version data seeded','upgrade':'update installed over previous public APK, test-owned data retained','update-prompt':'native update prompt, explicit consent, Later deferral and manual reopening'};
if(!Object.hasOwn(labels,kind))throw Error('Unknown Android test report kind');
if(!/\bOK \(1 test\)/.test(text)||!/INSTRUMENTATION_CODE: -1/.test(text)||/FAILURES!!!|INSTRUMENTATION_FAILED|shortMsg=|Process crashed/.test(text))throw Error('The signed release Android test did not complete successfully: '+kind);
console.log('SIGNED_RELEASE_ANDROID_TEST_OK: '+labels[kind]);

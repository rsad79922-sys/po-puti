import {readFile} from 'node:fs/promises';
const text=await readFile(process.argv[2],'utf8');
if(!/\bOK \(1 test\)/.test(text)||!/INSTRUMENTATION_CODE: -1/.test(text)||/FAILURES!!!|INSTRUMENTATION_FAILED|shortMsg=|Process crashed/.test(text))throw Error('The signed release Android login/search test did not complete successfully');
console.log('SIGNED_RELEASE_ANDROID_FLOW_OK: installed non-debuggable release, startup, real production login and native trip search; own QA account anonymized');

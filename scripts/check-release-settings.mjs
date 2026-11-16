// Configuration presence only. This does not certify licenses, signing or devices.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
export function releaseSettings(env){
 const present=name=>!!String(env[name]||'').trim(),confirmed=name=>env[name]==='true';
 const checks={
  raspKey:present('YANDEX_RASP_API_KEY'),raspTerms:confirmed('RASP_LICENSE_CONFIRMED'),
  raspQuota:Number.isInteger(Number(env.RASP_DAILY_LIMIT))&&Number(env.RASP_DAILY_LIMIT)>0&&Number(env.RASP_DAILY_LIMIT)<=1000,
  raspTtl:Number.isInteger(Number(env.RASP_CACHE_SECONDS))&&Number(env.RASP_CACHE_SECONDS)>0&&Number(env.RASP_CACHE_SECONDS)<=86400,
  advertisingTerms:confirmed('ADS_TERMS_CONFIRMED'),advertisingEnabled:confirmed('ADS_ENABLED'),advertisingProduction:env.ADS_TEST_MODE==='false',
  advertisingSlots:['WEB_SEARCH','WEB_RESULTS','ANDROID_SEARCH','ANDROID_RESULTS'].every(slot=>present('ADS_'+slot+'_ID')),
  advertisingWebOrigins:present('ADS_WEB_CSP_ORIGINS'),operator:present('PRIVACY_OPERATOR'),privacyContact:present('PRIVACY_CONTACT'),privacyApproval:confirmed('PRIVACY_POLICY_APPROVED'),
  geocoderUsage:env.GEOCODING_PROVIDER!=='yandex'||confirmed('GEOCODING_LICENSE_CONFIRMED')&&present('GEOCODING_LICENSE_REFERENCE'),
  previousVersion:/^[1-9]\d*$/.test(env.ANDROID_PREVIOUS_VERSION_CODE||''),previousSigner:/^[a-f0-9]{64}$/i.test((env.ANDROID_PREVIOUS_CERT_SHA256||'').replaceAll(':','')),
  administratorMfa:confirmed('ADMIN_MFA_REQUIRED')&&Buffer.from(env.ADMIN_MFA_ENCRYPTION_KEY||'','base64').length===32,
  rustoreProject:present('RUSTORE_PUSH_PROJECT_ID'),rustoreServerToken:present('RUSTORE_PUSH_SERVICE_TOKEN')
 };
 return {settingsComplete:Object.values(checks).every(Boolean),checks,missing:Object.keys(checks).filter(k=>!checks[k]),remainingEvidence:['signed APK matches previous certificate','update over previous APK without data loss','real background delivery on a device without GMS','owner approval of actual service terms and retention policy']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const env={...process.env};for(const path of process.argv.slice(2))Object.assign(env,parseEnv(readFileSync(path,'utf8')));
 const result=releaseSettings(env);console.log(JSON.stringify(result,null,2));if(!result.settingsComplete)process.exitCode=2;
}

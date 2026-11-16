import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
const config=parseEnv(readFileSync(process.argv[2],'utf8'));
if(!/^[A-Za-z0-9_-]{10,200}$/.test(config.YANDEX_RASP_API_KEY||''))throw Error('Missing or invalid private key');
try{
 const response=await fetch('https://api.rasp.yandex-net.ru/v3.0/copyright/?format=json',{
  headers:{Authorization:config.YANDEX_RASP_API_KEY},redirect:'error',signal:AbortSignal.timeout(12000)
 });
 const payload=await response.json().catch(()=>null);
 if(!response.ok||!payload?.copyright){console.error('RASP_PROBE_FAILED: HTTP '+response.status+'; no settings applied');process.exitCode=1}
 else console.log('RASP_PROBE_OK: authenticated public copyright request; no key or provider HTML exported');
}catch{console.error('RASP_PROBE_FAILED: network/timeout; no settings applied');process.exitCode=1}

#!/usr/bin/env node
const url=process.argv[2]||'http://127.0.0.1:8080/api/health';
try{
 const response=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error'});
 const body=await response.json();
 if(!response.ok||body.ok!==true||body.backend!=='sqlite')throw Error('Unhealthy API');
 console.log('HEALTH_OK',body.release||'legacy');
}catch(error){console.error('HEALTH_FAILED',error.message);process.exitCode=1}

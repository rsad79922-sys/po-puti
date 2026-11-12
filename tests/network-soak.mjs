import https from 'node:https';
import {setTimeout as sleep} from 'node:timers/promises';
const total=24,results=[];
for(let i=0;i<total;i++){
 const path=i%2===0?'/api/health':'/index.html?soak='+i;
 const result=await new Promise(resolve=>{
  let done=false;
  const started=Date.now();
  const req=https.get({hostname:'vputipoputka.ru',path,agent:false,timeout:5000,headers:{'cache-control':'no-cache'}},res=>{
   let n=0;res.on('data',chunk=>n+=chunk.length);
   res.on('end',()=>finish({status:res.statusCode,bytes:n}));
  });
  function finish(entry){
   if(done)return;done=true;
   resolve({index:i+1,path,duration_ms:Date.now()-started,...entry});
  }
  req.once('timeout',()=>req.destroy(new Error('timeout')));
  req.once('error',err=>finish({error:err.code||err.message}));
 });
 results.push(result);
 console.log('CHECK',new Date().toISOString(),JSON.stringify(result));
 if(i<total-1)await sleep(5000);
}
const ok=results.filter(x=>x.status===200).length;
const failed=results.length-ok;
console.log('SOAK_SUMMARY',JSON.stringify({attempts:results.length,ok,failed,status:failed===0?'stable_in_this_window':'intermittent_outage_observed'}));
// Diagnostic workflow must record failures without failing the workflow itself.

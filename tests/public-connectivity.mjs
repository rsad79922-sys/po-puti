/**
 * External connectivity probe, run on GitHub's network.
 * Read-only GET requests. This is not a test from Russian mobile operators,
 * but distinguishes common DNS / TCP / TLS / HTTP failures.
 */
import dns from 'node:dns/promises';
import https from 'node:https';

const domain='vputipoputka.ru';
const knownIp='130.49.129.99';
console.log('Outbound connectivity diagnostic from GitHub Actions');
for(const type of ['resolve4','resolve6']){
  try{const addresses=await dns[type](domain);console.log(type,addresses.join(', '))}
  catch(err){console.log(type,'NO RESULT',err.code||String(err))}
}
async function probe(label,hostname){
  return new Promise(resolve=>{
    let done=false;
    const t=Date.now();
    const timings={};
    function end(status,message){
      if(done)return;done=true;
      const output={probe:label,status,message,time_ms:Date.now()-t,events:timings};
      console.log(JSON.stringify(output));
      resolve(output);
    }
    const req=https.get({
      hostname,
      port:443,
      path:'/api/health',
      servername:domain,
      headers:{Host:domain,'User-Agent':'PoPuti-GitHub-External-Diagnostic/1.0'},
      agent:false,
      timeout:9000
    },res=>{
      let data='';
      res.on('data',b=>{if(data.length<300)data+=b.toString()});
      res.on('end',()=>end(res.statusCode===200?'PASS':'HTTP_ERROR',String(res.statusCode)+' '+data.slice(0,100)));
    });
    req.on('socket',socket=>{
      socket.on('lookup',(err,address,family)=>timings.lookup=err?String(err.code):address+' IPv'+family);
      socket.on('connect',()=>timings.tcp_ms=Date.now()-t);
      socket.on('secureConnect',()=>timings.tls_ms=Date.now()-t);
    });
    req.on('timeout',()=>req.destroy(new Error('Connection timed out')));
    req.on('error',err=>end('NETWORK_ERROR',err.code||err.message));
  });
}
await probe('HTTPS via domain DNS',domain);
await probe('HTTPS directly to configured IP with domain SNI',knownIp);
// Diagnostics do not decide CI success: results must be interpreted together
// with actual phone observations.

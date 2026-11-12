import dns from 'node:dns/promises';
import https from 'node:https';
const hostname='vputipoputka.ru';
console.log('NETWORK_DIAGNOSTIC_UTC',new Date().toISOString());
console.log('Repeat independent external check after reliability audit, Nov 13');
for(const type of ['resolve4','resolve6']){
 try{console.log(type,await dns[type](hostname))}
 catch(e){console.log(type,'ERROR',e.code||e.message)}
}
function probe(path,forceIp=false){
 return new Promise(resolve=>{
  const start=Date.now();
  const marks={};
  const req=https.get({
    hostname:forceIp?'130.49.129.99':hostname,port:443,path,
    family:forceIp?4:undefined,servername:hostname,
    headers:{Host:hostname,'User-Agent':'PoPuti-Diagnostic/1.0','Cache-Control':'no-cache'},
    agent:false,timeout:8000
  },res=>{
    let n=0;
    res.on('data',buf=>n+=buf.length);
    res.on('end',()=>finish({status:res.statusCode,bytes:n,content_type:res.headers['content-type']||''}));
  });
  let done=false;
  function finish(result){
   if(done)return;done=true;
   const report={target:forceIp?'direct-IP-with-SNI':'domain-DNS',path,...result,elapsed_ms:Date.now()-start,...marks};
   console.log(JSON.stringify(report));resolve(report);
  }
  req.on('socket',sock=>{
   sock.on('lookup',(err,addr,fam)=>{marks.dns=err?err.code:addr;marks.family=fam});
   sock.on('connect',()=>marks.tcp_ms=Date.now()-start);
   sock.on('secureConnect',()=>marks.tls_ms=Date.now()-start);
  });
  req.on('timeout',()=>req.destroy(new Error('timeout 8s')));
  req.on('error',err=>finish({error:err.code||err.message}));
 });
}
for(let i=0;i<3;i++){
 console.log('ROUND',i+1,new Date().toISOString());
 await probe('/api/health');
 await probe('/?check=networkprobe'+i);
 await probe('/api/health',true);
}

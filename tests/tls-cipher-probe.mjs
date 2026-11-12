import tls from 'node:tls';
import {performance} from 'node:perf_hooks';
const host='130.49.129.99';
const sni='vputipoputka.ru';
const variants=[
 ['TLS1.2-only', {minVersion:'TLSv1.2',maxVersion:'TLSv1.2'}],
 ['TLS1.3-X25519', {minVersion:'TLSv1.3',maxVersion:'TLSv1.3',ecdhCurve:'X25519'}],
 ['TLS1.3-default', {minVersion:'TLSv1.3',maxVersion:'TLSv1.3'}],
];
async function one(label,config){
 return new Promise(resolve=>{
  const begin=performance.now();const events={label};
  const socket=tls.connect({host,port:443,servername:sni,rejectUnauthorized:true,...config});
  let finished=false;
  const finish=(event,error)=>{
   if(finished)return;finished=true;
   events.event=event;events.ms=Math.round(performance.now()-begin);
   if(error)events.error=error.code||error.message;
   socket.destroy();console.log(JSON.stringify(events));resolve(events);
  };
  socket.setTimeout(6500);
  socket.once('connect',()=>events.tcp_ms=Math.round(performance.now()-begin));
  socket.once('secureConnect',()=>{events.protocol=socket.getProtocol();finish('TLS_OK')});
  socket.once('timeout',()=>finish('TLS_TIMEOUT'));
  socket.once('error',error=>finish('ERROR',error));
 });
}
console.log('TLS_VARIANTS_UTC',new Date().toISOString());
for(let round=0;round<2;round++){
 console.log('ROUND',round+1);
 for(const [name,settings] of variants)await one(name,settings);
}

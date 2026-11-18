import https from 'node:https';
import http from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

// Real loopback TLS for browser downloads, which can bypass Playwright routing.
// The one-day test key is generated in a private temp directory, never committed
// or installed in a trust store. No request leaves the local test servers.
export async function loopbackHttps(){
 const dir=await mkdtemp(join(tmpdir(),'poputi-test-tls-'));let target='';
 let server;
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem')],{stdio:'ignore',timeout:10000});
  let downloads=0;
  server=https.createServer({key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'))},(req,res)=>{
   if(!target){res.writeHead(503);res.end();return}
   if(req.method==='GET'&&new URL(req.url,'https://localhost').pathname==='/downloads/po-puti.apk')downloads++;
   const path=new URL(req.url,'https://localhost'),url=new URL(path.pathname+path.search,target);
   const upstream=http.request(url,{method:req.method,headers:{...req.headers,host:url.host}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)});
   upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});
   req.on('error',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  return {base:'https://127.0.0.1:'+server.address().port,forwardTo:url=>{target=url},downloads:()=>downloads,async stop(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true})}};
 }catch(error){server?.close();await rm(dir,{recursive:true,force:true});throw error}
}

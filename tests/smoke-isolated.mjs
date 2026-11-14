import {spawn} from 'node:child_process';
import {isolatedServer} from './helpers/server.mjs';
const app=await isolatedServer();
try{
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['tests/smoke-api.mjs'],{env:{...process.env,API_BASE:app.base},stdio:'inherit'});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('smoke failed: '+code)));
 });
}finally{await app.stop()}

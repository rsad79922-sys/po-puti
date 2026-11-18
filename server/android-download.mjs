import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {pipeline} from 'node:stream/promises';

// Only the explicitly published APK is public. Never enumerate the data directory
// or follow a symlink to a database, keystore, backup or user upload.
export async function serveAndroidApk(req,res,path){
 let file;
 try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)}
 catch(error){if(['ENOENT','ENOTDIR','ELOOP'].includes(error.code))return false;throw error}
 try{
  const info=await file.stat();
  if(!info.isFile()||info.size===0)return false;
  res.writeHead(200,{
   'content-type':'application/vnd.android.package-archive',
   'content-disposition':'attachment; filename="po-puti.apk"',
   'content-length':info.size,
   'cache-control':'no-store',
   'x-content-type-options':'nosniff'
  });
  if(req.method==='HEAD')res.end();
  else try{await pipeline(file.createReadStream(),res)}catch{res.destroy()}
  return true;
 }finally{await file.close()}
}

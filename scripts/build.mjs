// The web client is plain JS. Build validates assets and packages only runtime code.
import {readFile,writeFile,mkdir,cp,rm,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const manifest=JSON.parse(await readFile('www/manifest.webmanifest','utf8'));
const html=await readFile('www/index.html','utf8');
for(const asset of [...manifest.icons.map(i=>i.src),...Array.from(html.matchAll(/(?:href|src)="(\/[^"?#]+)(?:[?#][^"]*)?"/g),m=>m[1])]){
 const path=resolve('www','.'+(asset.startsWith('/')?asset:'/'+asset.replace(/^\.\//,'')));
 if(!path.startsWith(resolve('www')+'/'))throw Error('Asset escapes web root');
 if(!(await stat(path)).isFile())throw Error('Missing asset: '+asset);
 if(path.endsWith('.png')){
  const png=await readFile(path);const icon=manifest.icons.find(i=>path.endsWith(i.src.replace('./','/')));
  if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid PNG: '+path);
  if(icon&&icon.sizes!==png.readUInt32BE(16)+'x'+png.readUInt32BE(20))throw Error('Icon size mismatch');
 }
}
// dist is disposable output only; no server-data, uploads or environment files.
await rm('dist',{recursive:true,force:true});await mkdir('dist');
for(const path of ['www','server','deploy','package.json','package-lock.json'])await cp(path,join('dist',path),{recursive:true});
const sums={};
async function walk(dir){for(const name of (await readdir(dir)).sort()){const path=join(dir,name);if((await stat(path)).isDirectory())await walk(path);else sums[path.slice(5)]=createHash('sha256').update(await readFile(path)).digest('hex')}}
await walk('dist');await writeFile('dist/checksums.json',JSON.stringify(sums,null,2)+'\n');
console.log('BUILD_OK: validated PWA assets, server and deployment templates in dist/');

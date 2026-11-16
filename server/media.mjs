import sharp from 'sharp';
import {fail} from './lifecycle.mjs';
import {createHash} from 'node:crypto';
let active=0;
const inFlight=new Map();
// Decode only new uploads. Existing files and legacy data are never rewritten here.
export async function normalizePhoto(bytes,maxBytes){
 const key=createHash('sha256').update(bytes).update(':'+maxBytes).digest('hex');
 if(inFlight.has(key))return inFlight.get(key);
 if(active>=2)throw fail('Обработка фотографий занята. Повторите позже.',503);active++;
 const task=(async()=>{
 try{
  const settings={limitInputPixels:20_000_000,failOn:'error',animated:false};
  const meta=await sharp(bytes,settings).metadata();if(!meta.width||!meta.height||meta.pages>1)throw Error('image');
  for(const [size,quality] of [[1600,82],[800,60],[512,45]]){
   const result=await sharp(bytes,settings).timeout({seconds:5}).rotate().resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality}).toBuffer();
   if(result.length<=maxBytes)return result;
  }
  throw fail('Фото слишком большое после обработки',413);
 }catch(error){if(error.status)throw error;throw fail('Не удалось прочитать изображение. Выберите исправное JPEG, PNG или WebP.')}
 finally{active--}
 })();inFlight.set(key,task);try{return await task}finally{inFlight.delete(key)}
}

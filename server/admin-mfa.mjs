import {createCipheriv,createDecipheriv,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {fail} from './lifecycle.mjs';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes){let bits='';for(const b of bytes)bits+=b.toString(2).padStart(8,'0');let out='';for(let i=0;i<bits.length;i+=5)out+=alphabet[parseInt(bits.slice(i,i+5).padEnd(5,'0'),2)];return out}
function unbase32(s){let bits='';for(const c of s)bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');return Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)))}
export function totp(secret,step){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const h=createHmac('sha1',unbase32(secret)).update(counter).digest(),i=h[19]&15;return String((h.readUInt32BE(i)&0x7fffffff)%1000000).padStart(6,'0')}
export function adminMfa(db,{env=process.env,clock=Date.now}={}){
 const key=Buffer.from(env.ADMIN_MFA_ENCRYPTION_KEY||'','base64'),configured=key.length===32;
 const get=id=>db.prepare('SELECT * FROM admin_mfa WHERE user_id=?').get(id);
 function encrypt(secret){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([c.update(secret,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64')}
 function decrypt(s){if(!configured)throw fail('MFA временно недоступна',503);const b=Buffer.from(s,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8')}
 function verify(id,value,enabling=false){const row=get(id);if(!row||!enabling&&!row.enabled)throw fail('Сначала настройте MFA',409);if(!/^\d{6}$/.test(String(value||'')))throw fail('Укажите шестизначный код MFA',401);const step=Math.floor(clock()/30000),secret=decrypt(row.secret_enc);for(const n of [step,step-1,step+1])if(n>row.last_step&&timingSafeEqual(Buffer.from(totp(secret,n)),Buffer.from(value))){db.prepare('UPDATE admin_mfa SET last_step=?,enabled=1 WHERE user_id=?').run(n,id);return true}throw fail('Неверный или уже использованный код MFA',401)}
 function enroll(actor){if(!configured)throw fail('Владелец должен настроить защищённый ключ MFA на сервере',503);if(get(actor.id)?.enabled)throw fail('MFA уже включена',409);const secret=base32(randomBytes(20));db.prepare('INSERT INTO admin_mfa VALUES(?,?,0,-1) ON CONFLICT(user_id) DO UPDATE SET secret_enc=excluded.secret_enc,last_step=-1').run(actor.id,encrypt(secret));return {secret,uri:'otpauth://totp/'+encodeURIComponent('По пути:'+actor.username)+'?secret='+secret+'&issuer='+encodeURIComponent('По пути')}}
 return {get,verify,enroll,required:()=>env.ADMIN_MFA_REQUIRED==='true',configured};
}

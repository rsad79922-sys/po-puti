import tzlookup from 'tz-lookup';
import {fail} from './lifecycle.mjs';
export function validZone(value){if(typeof value!=='string'||value.length>80)throw fail('Укажите часовой пояс IANA');try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return value}catch{throw fail('Неизвестный часовой пояс IANA')}}
export const zoneAt=(lon,lat)=>tzlookup(lat,lon);
export function localParts(at,zone){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:validZone(zone),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(at);return Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]))}
export function offsetAt(at,zone){const p=localParts(at,zone);return Math.round((Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(at/1000)*1000)/60000)}
export const offsetText=minutes=>(minutes<0?'-':'+')+String(Math.floor(Math.abs(minutes)/60)).padStart(2,'0')+':'+String(Math.abs(minutes)%60).padStart(2,'0');
export function zonedTime(at,zone){const p=localParts(at,zone);return {local:p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute,timeZone:zone,offset:offsetText(offsetAt(at,zone))}}
export function localToUTC(date,time,zone,preferredOffset){
 validZone(zone);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw fail('Проверьте дату и время');
 const nominal=Date.parse(date+'T'+time+':00Z');const offsets=new Set([-24,-12,0,12,24].map(h=>offsetAt(nominal+h*3600000,zone)));
 const matches=[...offsets].map(o=>({at:nominal-o*60000,offset:offsetText(o)})).filter(x=>zonedTime(x.at,zone).local===date+' '+time&&(!preferredOffset||x.offset===preferredOffset));
 if(matches.length!==1)throw fail(matches.length?'Неоднозначное время при переводе часов: укажите смещение UTC':'Такого местного времени нет в выбранном часовом поясе');return matches[0];
}

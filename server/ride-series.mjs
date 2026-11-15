import {randomUUID} from 'node:crypto';
import {fail} from './lifecycle.mjs';
import {localToUTC} from './timezones.mjs';

const day=86400000;
export function seriesDates(data){
 const start=String(data.date||''),end=String(data.seriesEnd||''),valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!valid(start)||!valid(end))throw fail('Проверьте начало и окончание серии');
 const span=(Date.parse(end)-Date.parse(start))/day;
 if(span<0||span>6)throw fail('Серия допускается максимум на 7 календарных дней, включая начало');
 const weekdays=data.weekdays;if(!Array.isArray(weekdays)||!weekdays.length||weekdays.some(n=>!Number.isInteger(n)||n<0||n>6))throw fail('Выберите дни недели');
 const exceptions=data.exceptions||[];if(!Array.isArray(exceptions)||exceptions.length>7||exceptions.some(d=>!valid(d)||d<start||d>end))throw fail('Проверьте исключения по датам');
 const dates=[];for(let t=Date.parse(start);t<=Date.parse(end);t+=day){const d=new Date(t);const s=d.toISOString().slice(0,10);if(weekdays.includes(d.getUTCDay())&&!exceptions.includes(s))dates.push(s)}
 if(!dates.length)throw fail('В выбранном периоде нет отправлений');return dates;
}
export function rideSeries(life,router){
 const {get,all,run,tx,clock}=life;
 async function create(actor,data,insertRide){
  const key=String(data.clientKey||'');if(!/^[a-zA-Z0-9_-]{10,80}$/.test(key))throw fail('Укажите ключ операции');
  const prior=get('SELECT id FROM ride_series WHERE driver_id=? AND client_key=?',actor.id,key);
  if(prior)return result(prior.id,true);
  if(data.privateRide!==true)throw fail('Подтвердите частный характер поездок');
  if(get('SELECT COUNT(*) n FROM ride_series WHERE driver_id=? AND created_at>?',actor.id,clock()-day).n>=10)throw fail('Достигнут дневной лимит серий',429);
  const dates=seriesDates(data),plan=router.prepare(actor,data);if(!plan||plan.etaSource==='manual')throw fail('Дождитесь автоматического расчёта маршрута',409);
  const plans=[];
  for(const date of dates){
   const departure=localToUTC(date,data.time,plan.departureTimeZone,data.departureOffset);
   if(departure.at<=clock())throw fail('Все отправления серии должны быть в будущем');
   // Owned BRouter/OSRM geometry is time-independent; traffic providers require individual quotes.
   let next={...plan,departureAt:departure.at,departureOffset:departure.offset,arrivalAt:departure.at+plan.durationMinutes*60000};
   if(!['brouter','osrm','valhalla','ors'].includes(plan.etaSource)&&date!==data.date){
    const quote=await router.estimate(actor,{...data,date,routePoints:plan.points,departureOffset:undefined});
    if(!quote.available)throw fail('Не удалось рассчитать все отправления',503);next=router.prepare(actor,{...data,date,routeQuoteId:quote.routeQuoteId,routePoints:plan.points});
   }
   plans.push({date,plan:next});
  }
  return tx(()=>{
   const repeated=get('SELECT id FROM ride_series WHERE driver_id=? AND client_key=?',actor.id,key);if(repeated)return result(repeated.id,true);
   const id=randomUUID();const template={from:data.from,to:data.to,seats:data.seats,price:data.price,car:data.car,pickup:data.pickup||'',dropoff:data.dropoff||''};
   run('INSERT INTO ride_series(id,driver_id,start_date,end_date,weekdays_json,time,time_zone,template_json,created_at,client_key) VALUES(?,?,?,?,?,?,?,?,?,?)',id,actor.id,data.date,data.seriesEnd,JSON.stringify(data.weekdays),data.time,plan.departureTimeZone,JSON.stringify(template),clock(),key);
   for(const date of data.exceptions||[])run('INSERT INTO ride_series_exceptions VALUES(?,?,?)',id,date,'Исключено водителем при создании');
   for(const item of plans)insertRide(item.date,item.plan,id);
   run('INSERT INTO ride_series_revisions VALUES(?,?,?,?,?,?)',randomUUID(),id,actor.id,clock(),'created',JSON.stringify({dates}));
   return result(id,false);
  });
 }
 function result(id,repeated){return {id,seriesId:id,repeated,rides:all('SELECT id,date,time,cancelled FROM rides WHERE series_id=? ORDER BY date',id)}}
 function list(actor){return {items:all('SELECT id,start_date startDate,end_date endDate,time,time_zone timeZone,revision,weekdays_json weekdaysJson FROM ride_series WHERE driver_id=? ORDER BY created_at DESC LIMIT 100',actor.id).map(s=>({...s,weekdays:JSON.parse(s.weekdaysJson),rides:result(s.id).rides}))}}
 function cancel(actor,id){
  const s=get('SELECT * FROM ride_series WHERE id=?',id);if(!s)throw fail('Серия не найдена',404);if(s.driver_id!==actor.id)throw fail('Это не ваша серия',403);
  return tx(()=>{const rides=all('SELECT * FROM rides WHERE series_id=? AND cancelled=0 AND departure_at>?',id,clock());for(const r of rides){life.mutable(r);run('UPDATE rides SET cancelled=1 WHERE id=?',r.id);run('INSERT OR IGNORE INTO ride_series_exceptions VALUES(?,?,?)',id,r.date,'Водитель отменил оставшиеся отправления');for(const request of all("SELECT * FROM requests WHERE ride_id=? AND status IN ('pending','accepted')",r.id)){run("UPDATE requests SET status='cancelled' WHERE id=?",request.id);life.event(request.user_id,'ride_cancelled','series-cancel:'+r.id,'Поездка отменена','Водитель отменил поездку.','/ride/'+r.id,r.id)}}run('INSERT INTO ride_series_revisions VALUES(?,?,?,?,?,?)',randomUUID(),id,actor.id,clock(),'cancel_future',JSON.stringify({rides:rides.map(r=>r.id)}));return result(id,false)});
 }
 function update(actor,id,data){
  const s=get('SELECT * FROM ride_series WHERE id=?',id);if(!s)throw fail('Серия не найдена',404);if(s.driver_id!==actor.id)throw fail('Это не ваша серия',403);
  const plan=router.prepare(actor,data);if(!plan||plan.etaSource==='manual')throw fail('Дождитесь автоматического расчёта',409);
  const from=String(data.from||'').trim(),to=String(data.to||'').trim();if(!from||!to||from.length>100||to.length>100||from===to)throw fail('Проверьте маршрут');
  return tx(()=>{const rides=all('SELECT * FROM rides WHERE series_id=? AND cancelled=0 AND departure_at>? ORDER BY date',id,clock());if(!rides.length)throw fail('Будущих поездок нет. Создайте новую серию.',409);
   if(data.date!==rides[0].date)throw fail('Даты серии не переносятся. Для новых дат создайте новую серию.',409);
   if(rides.some(r=>get("SELECT id FROM requests WHERE ride_id=? AND status IN ('pending','accepted')",r.id)))throw fail('В серии есть заявки. Изменяйте свободные даты отдельно; перенос пассажиров не выполняется.',409);
   if(!['osrm','brouter','valhalla','ors'].includes(plan.etaSource))throw fail('Этот поставщик требует отдельных расчётов для каждой даты',409);
   for(const r of rides){life.mutable(r);const dep=localToUTC(r.date,data.time,plan.departureTimeZone);if(dep.at<=clock())throw fail('Отправления должны быть в будущем',409);run('UPDATE rides SET origin=?,destination=?,time=?,pickup=?,dropoff=? WHERE id=?',from,to,data.time,String(data.pickup||'').slice(0,150),String(data.dropoff||'').slice(0,150),r.id);router.attach(r.id,actor,{...plan,departureAt:dep.at,departureOffset:dep.offset,arrivalAt:dep.at+plan.durationMinutes*60000},'Водитель изменил маршрут и время будущих экземпляров серии');}
   run('UPDATE ride_series SET time=?,time_zone=?,revision=revision+1 WHERE id=?',data.time,plan.departureTimeZone,id);run('INSERT INTO ride_series_revisions VALUES(?,?,?,?,?,?)',randomUUID(),id,actor.id,clock(),'updated_future',JSON.stringify({rides:rides.map(r=>r.id),from,to,time:data.time}));return result(id,false);
  });
 }
 return {create,list,cancel,update};
}

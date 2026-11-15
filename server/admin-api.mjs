import {fail} from './lifecycle.mjs';
const entities={users:'users',rides:'rides',bookings:'requests',reviews:'review_admin_view',complaints:'reports',notifications:'notifications',audit:'admin_audit_log',deliveries:'push_outbox',templates:'system_message_templates'};
export function adminApi(l){
 const {get,all,run,tx,audit,clock,ride,members,event}=l;
 const safeUser=u=>({id:u.id,username:u.username,name:u.name,phone:u.phone,role:u.role,created:u.created,blockedAt:u.blocked_at,blockedReason:u.blocked_reason});
 const reason=data=>{if(typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>1000)throw fail('Укажите причину решения (до 1000 символов)');return data.reason.trim()};
 function handle(actor,path,method,data,params){
  if(actor.role!=='admin')throw fail('Нет прав администратора',403);
  if(path==='/api/admin/v3/summary'&&method==='GET'){
   const since=Number(params.get('since')||0),until=Number(params.get('until')||clock());
   if(!Number.isFinite(since)||!Number.isFinite(until)||since>until)throw fail('Неверный период');
   const rides=all('SELECT * FROM rides WHERE created BETWEEN ? AND ?',since,until),reviews=all('SELECT p.* FROM review_admin_view p JOIN rides r ON r.id=p.ride_id WHERE p.submitted_at BETWEEN ? AND ?',since,until);
   return {users:get('SELECT COUNT(*) n FROM users WHERE created BETWEEN ? AND ?',since,until).n,scheduled:rides.filter(r=>l.describe(r).phase==='scheduled').length,inProgress:rides.filter(r=>l.describe(r).phase==='in_progress').length,past:rides.filter(r=>l.describe(r).phase==='past').length,cancelled:rides.filter(r=>r.cancelled).length,confirmedBookings:get("SELECT COUNT(*) n FROM requests WHERE status='accepted' AND created BETWEEN ? AND ?",since,until).n,openComplaints:get("SELECT COUNT(*) n FROM reports WHERE status='open' AND created BETWEEN ? AND ?",since,until).n,disputed:rides.filter(r=>r.outcome==='disputed').length,pendingReviews:reviews.filter(r=>!l.publicReview(r).isPublished).length,publishedReviews:reviews.filter(r=>l.publicReview(r).isPublished).length,pushErrors:get("SELECT COUNT(*) n FROM push_outbox WHERE status IN ('failed','retry')").n};
  }
  if(path==='/api/admin/v3/system'&&method==='GET')return {serverNow:clock(),workers:all('SELECT * FROM background_state'),push:l.pushAvailable(),queues:all('SELECT status,COUNT(*) count FROM push_outbox GROUP BY status'),duplicateReviews:all('SELECT ride_id,author_id,target_user_id,COUNT(*) n FROM pair_reviews GROUP BY ride_id,author_id,target_user_id HAVING COUNT(*)>1').length,version:'route-v4',serviceWorker:'route-v4',routingDiagnostics:get("SELECT name FROM sqlite_master WHERE name='routing_diagnostics'")?all('SELECT * FROM routing_diagnostics'):[],geocoderFreeLimit:900,geocoderRequestsLast24h:get("SELECT name FROM sqlite_master WHERE name='routing_provider_usage'")?get("SELECT COUNT(*) n FROM routing_provider_usage WHERE provider='yandex_geocoder' AND requested_at>?",clock()-86400000).n:0,missingEta:get('SELECT COUNT(*) n FROM rides WHERE estimated_arrival_at IS NULL').n};
  let m=path.match(/^\/api\/admin\/v3\/([a-z]+)$/);
  if(m&&method==='GET'&&entities[m[1]]){
   const page=Number(params.get('page')||1),size=Number(params.get('size')||25);
   if(!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1||size>100)throw fail('Неверная страница');
   const kind=m[1],table=entities[kind],term=params.get('q')||'',status=params.get('status')||'',from=params.get('from')||'',to=params.get('to')||'';
   const fields={users:['id','username','name','phone'],rides:['id','origin','destination','driver_id'],bookings:['id','ride_id','user_id'],reviews:['id','ride_id','author_id','target_user_id'],complaints:['id','ride_id','author_id','reason'],notifications:['id','recipient_id','kind'],audit:['actor_id','entity_type','entity_id','action'],deliveries:['id','notification_id','status'],templates:['kind','title']}[kind];
   const args=[],clauses=[];
   if(term){clauses.push('('+fields.map(f=>f+' LIKE ?').join(' OR ')+')');args.push(...fields.map(()=>'%'+term.slice(0,100)+'%'))}
   if(status){const field={users:'blocked_at',rides:'outcome',bookings:"CASE WHEN expired_at IS NOT NULL THEN 'expired' ELSE status END",reviews:"CASE WHEN moderation_status='blocked' THEN 'blocked' WHEN published_at IS NULL THEN 'pending' ELSE 'published' END",complaints:'status',notifications:"CASE WHEN read=1 THEN 'read' ELSE 'unread' END",deliveries:'status',audit:'action'}[kind];if(field){if(kind==='users')clauses.push('blocked_at IS '+(status==='blocked'?'NOT ':'')+'NULL');else{clauses.push(field+'=?');args.push(status)}}}
   if(['users','bookings','reviews','complaints','notifications','audit'].includes(kind)){const field=kind==='reviews'?'submitted_at':kind==='audit'?'created_at':'created';if(from){const value=Date.parse(from+'T00:00:00Z');if(!Number.isFinite(value))throw fail('Неверная дата');clauses.push(field+'>=?');args.push(value)}if(to){const value=Date.parse(to+'T23:59:59Z');if(!Number.isFinite(value))throw fail('Неверная дата');clauses.push(field+'<=?');args.push(value)}}
   if(kind==='rides'){if(from&&!/^\d{4}-\d{2}-\d{2}$/.test(from)||to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))throw fail('Неверная дата');if(from){clauses.push('date>=?');args.push(from)}if(to){clauses.push('date<=?');args.push(to)}}
   const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
   const total=get('SELECT COUNT(*) n FROM '+table+where,...args).n;
   const result=all('SELECT * FROM '+table+where+' ORDER BY '+(kind==='templates'?'kind':kind==='reviews'?'submitted_at':'rowid')+' DESC LIMIT ? OFFSET ?',...args,size,(page-1)*size);
   return {page,size,total,items:result.map(x=>kind==='users'?safeUser(x):kind==='rides'?{...x,...l.describe(x),confirmations:all('SELECT * FROM ride_confirmations WHERE ride_id=?',x.id)}:kind==='notifications'?{id:x.id,recipientId:x.recipient_id,kind:x.kind,created:x.created,readAt:x.read_at}:kind==='bookings'?{...x,status:x.expired_at?'expired':x.status}:kind==='reviews'?l.publicReview(x):x)};
  }
  m=path.match(/^\/api\/admin\/v3\/users\/([^/]+)$/);
  if(m&&method==='GET'){
   const user=get('SELECT * FROM users WHERE id=?',m[1]);if(!user)throw fail('Пользователь не найден',404);
   return {user:safeUser(user),rides:all('SELECT * FROM rides WHERE driver_id=? OR id IN (SELECT ride_id FROM requests WHERE user_id=?)',user.id,user.id),complaints:all('SELECT * FROM reports WHERE author_id=? OR ride_id IN (SELECT id FROM rides WHERE driver_id=?)',user.id,user.id),reviews:all('SELECT * FROM review_admin_view WHERE author_id=? OR target_user_id=? ORDER BY submitted_at DESC LIMIT 100',user.id,user.id).map(l.publicReview),audit:all("SELECT * FROM admin_audit_log WHERE entity_type='user' AND entity_id=? ORDER BY created_at DESC LIMIT 100",user.id)};
  }
  m=path.match(/^\/api\/admin\/v3\/rides\/([^/]+)$/);
  if(m&&method==='GET'){const trip=ride(m[1]);return {ride:{...trip,...l.describe(trip)},confirmations:all('SELECT * FROM ride_confirmations WHERE ride_id=?',trip.id),bookings:all('SELECT * FROM requests WHERE ride_id=?',trip.id).map(x=>({...x,status:x.expired_at?'expired':x.status})),reviews:all('SELECT * FROM review_admin_view WHERE ride_id=?',trip.id).map(l.publicReview),complaints:all('SELECT * FROM reports WHERE ride_id=?',trip.id),etaHistory:all('SELECT * FROM ride_eta_history WHERE ride_id=? ORDER BY created_at DESC',trip.id),decisions:all('SELECT * FROM moderation_decisions WHERE ride_id=?',trip.id)}}
  m=path.match(/^\/api\/admin\/v3\/(users|rides|reviews|complaints)\/([^/]+)\/(block|unblock|outcome|resolve)$/);
  if(m&&method==='POST')return tx(()=>{
   const [,type,id,action]=m,r=reason(data);
   if(type==='users'&&['block','unblock'].includes(action)){
    const user=get('SELECT * FROM users WHERE id=?',id);if(!user)throw fail('Пользователь не найден',404);
    if(action==='block'&&(user.id===actor.id||user.role==='admin'))throw fail('Блокировка администратора через панель запрещена',409);
    const blocked=action==='block'?clock():null;if(!!user.blocked_at===!!blocked)return {ok:true,repeated:true};run('UPDATE users SET blocked_at=?,blocked_reason=? WHERE id=?',blocked,blocked?r:'',id);
    audit(actor,'user',id,action,{blockedAt:user.blocked_at},{blockedAt:blocked},r);
    if(blocked){run('DELETE FROM sessions WHERE user_id=?',id);run("UPDATE push_outbox SET status='cancelled' WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE user_id=?) AND status IN ('pending','retry','sending')",id);run('UPDATE push_subscriptions SET active=0 WHERE user_id=?',id)}
    return {ok:true};
   }
   if(type==='rides'&&['block','unblock','outcome'].includes(action)){
    const trip=ride(id);
    if(action==='outcome'){
     if(!['completed','not_held','unverified','disputed'].includes(data.outcome))throw fail('Неверный исход');
     if(trip.cancelled||l.describe(trip).phase==='scheduled'||trip.estimated_arrival_at&&clock()<trip.estimated_arrival_at)throw fail('Исход поездки пока изменить нельзя',409);
     if(trip.outcome_override===data.outcome)return {ok:true,repeated:true};
     run('UPDATE rides SET outcome_override=?,outcome=? WHERE id=?',data.outcome,data.outcome,id);
     run('INSERT INTO moderation_decisions VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,null,data.outcome,r,clock());
     audit(actor,'ride',id,action,{outcome:trip.outcome},{outcome:data.outcome},r);
    }else{if(!!trip.moderation_blocked===(action==='block'))return {ok:true,repeated:true};run('UPDATE rides SET moderation_blocked=? WHERE id=?',action==='block'?1:0,id);audit(actor,'ride',id,action,{blocked:!!trip.moderation_blocked},{blocked:action==='block'},r)}
    for(const user of members(trip))event(user,'moderation_result','ride-decision:'+crypto.randomUUID(),'Решение по поездке','Модератор рассмотрел обращение.','/ride/'+id,id);
    return {ok:true};
   }
   if(type==='reviews'&&['block','unblock'].includes(action)){
    const review=get('SELECT * FROM review_admin_view WHERE id=?',id);if(!review)throw fail('Отзыв не найден',404);
    const status=action==='block'?'blocked':'allowed';if(review.moderation_status===status)return {ok:true,repeated:true};if(review.source==='legacy')run('INSERT INTO legacy_review_moderation VALUES(?,?) ON CONFLICT(review_id) DO UPDATE SET status=excluded.status',id,status);else run('UPDATE pair_reviews SET moderation_status=? WHERE id=?',status,id);audit(actor,'review',id,action,{status:review.moderation_status},{status},r);return {ok:true};
   }
   if(type==='complaints'&&action==='resolve'){
    const report=get('SELECT * FROM reports WHERE id=?',id);if(!report)throw fail('Жалоба не найдена',404);
    if(!['completed','not_held','unverified','closed'].includes(data.decision))throw fail('Выберите решение');
    if(report.status==='resolved'&&report.decision===data.decision)return {ok:true,repeated:true};
    run('INSERT INTO moderation_decisions VALUES(?,?,?,?,?,?)',crypto.randomUUID(),report.ride_id,id,data.decision,r,clock());
    run("UPDATE reports SET status='resolved',decision=?,resolved_at=? WHERE id=?",data.decision,clock(),id);
    if(data.decision!=='closed'){const trip=ride(report.ride_id);if(trip.cancelled||l.describe(trip).phase==='scheduled'||trip.estimated_arrival_at&&clock()<trip.estimated_arrival_at)throw fail('Исход поездки пока изменить нельзя',409);run('UPDATE rides SET outcome_override=?,outcome=? WHERE id=?',data.decision,data.decision,trip.id)}
    audit(actor,'complaint',id,'resolve',{status:report.status,decision:report.decision},{status:'resolved',decision:data.decision},r);
    for(const user of new Set([report.author_id,...members(ride(report.ride_id))]))event(user,'complaint_result','complaint-result:'+id+':'+clock(),'Обращение рассмотрено','Решение доступно в вашем обращении.','/complaints',report.ride_id);
    return {ok:true};
   }
   throw fail('Операция не поддерживается',404);
  });
  if(path==='/api/admin/v3/templates'&&method==='POST')return tx(()=>{
   const why=reason(data),k=String(data.kind||'');
   if(!['ride_confirmation','review_reminder','review_published','complaint_result','moderation_result'].includes(k))throw fail('Недопустимый системный шаблон');
   if(typeof data.title!=='string'||!data.title.trim()||data.title.length>80||typeof data.body!=='string'||data.body.length>250)throw fail('Проверьте заголовок и сообщение');
   const old=get('SELECT * FROM system_message_templates WHERE kind=?',k)||null;
   run('INSERT INTO system_message_templates VALUES(?,?,?) ON CONFLICT(kind) DO UPDATE SET title=excluded.title,body=excluded.body',k,data.title.trim(),data.body.trim());audit(actor,'template',k,'update',old,{title:data.title,body:data.body},why);return {ok:true};
  });
  if(path==='/api/admin/v3/push-test'&&method==='POST')return tx(()=>{const why=reason(data);event(actor.id,'push_test','test:'+crypto.randomUUID(),'Проверка уведомлений','Тестовое уведомление администратору.','/admin');audit(actor,'notification',actor.id,'self_test',null,{recipient:actor.id},why);return {ok:true}});
  throw fail('Административный маршрут не найден',404);
 }
 return handle;
}

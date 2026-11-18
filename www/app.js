'use strict';
/* ПО ПУТИ v0.2 — локальная демоверсия и клиент единого API для Android + PWA. */
const STORE = 'po-puti-prototype-v2';
const TOKEN_STORE = 'po-puti-access-v2';
const COOKIE_STORE = 'po-puti-cookie-session-v1';
const safeStorage = {getItem(key){try{return localStorage.getItem(key)}catch{return null}},setItem(key,value){try{localStorage.setItem(key,value)}catch{}},removeItem(key){try{localStorage.removeItem(key)}catch{}}};
const DEMO_HASH_SALT = 'po-puti-demo-v2:';
const SERVER_BASE = (window.PO_PUTI_API_BASE || '').replace(/\/$/, '');
let remoteMode = window.PO_PUTI_BACKEND === true || !!window.PO_PUTI_API_BASE;
const cookieSession = remoteMode && !SERVER_BASE;
let accessToken = (cookieSession?safeStorage.getItem(COOKIE_STORE):'') || safeStorage.getItem(TOKEN_STORE) || '';
const isCookieToken = token => token.startsWith('cookie:');
let adminData = null;
let serverError = '';
let accountTab = 'login';
const featureState={config:null,loading:false,queryKey:'',epoch:0,bus:{items:[],status:'idle'},private:null,filter:'private',choices:{},consent:false};
let chatRecipientId = null;
let chatRideId = null;
let publishing = false;

const cityOptions = ['Москва','Санкт-Петербург','Казань','Нижний Новгород','Тверь','Воронеж','Владимир','Рязань','Тула','Ярославль','Сочи','Краснодар','Ростов-на-Дону','Самара','Уфа','Екатеринбург','Пермь','Новосибирск','Омск','Тюмень','Челябинск','Волгоград','Саратов','Ульяновск','Ижевск','Калуга','Брянск','Белгород','Курск','Липецк','Псков','Великий Новгород','Петрозаводск'];
const $ = (s, root = document) => root.querySelector(s);
const safe = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = (extra = 0) => {const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+extra); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const dateLabel = d => { if (!d) return 'Дата не указана'; const n = new Date(d+'T12:00:00'); return Number.isFinite(n.getTime()) ? n.toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'short'}) : d; };
const money = n => n === null || n === '' || typeof n === 'undefined' ? 'По договорённости' : `${Number(n).toLocaleString('ru-RU')} ₽`;
const ids = () => 'id_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
function seed(){
  return { currentUserId:'u_demo', users:[
    {id:'u_demo',username:'maria',passwordHash:'3f7541e74748d39e3a5e6d473b12cdce07e88b7b4abfaac8be2df37fd15dd97b',name:'Мария',phone:'+79990000004',car:'',photo:'',role:'user'},
    {id:'u_driver1',username:'alex',passwordHash:'3f7541e74748d39e3a5e6d473b12cdce07e88b7b4abfaac8be2df37fd15dd97b',name:'Александр',phone:'+79990000001',car:'Toyota Camry',photo:'',role:'user'},
    {id:'u_driver2',username:'irina',passwordHash:'3f7541e74748d39e3a5e6d473b12cdce07e88b7b4abfaac8be2df37fd15dd97b',name:'Ирина',phone:'+79990000002',car:'Kia Rio',photo:'',role:'user'},
    {id:'u_driver3',username:'timur',passwordHash:'3f7541e74748d39e3a5e6d473b12cdce07e88b7b4abfaac8be2df37fd15dd97b',name:'Тимур',phone:'+79990000003',car:'Hyundai Solaris',photo:'',role:'user'},
    {id:'u_admin',username:'admin-demo',passwordHash:'3f7541e74748d39e3a5e6d473b12cdce07e88b7b4abfaac8be2df37fd15dd97b',name:'Администратор',phone:'',car:'',photo:'',role:'admin'}],
    rides:[
      {id:'r1',driverId:'u_driver1',from:'Москва',to:'Санкт-Петербург',date:today(1),time:'08:30',seats:3,price:2200,car:'Toyota Camry',pickup:'Метро Ховрино',dropoff:'Московский вокзал',luggage:'Средний багаж',comment:'Едем по платной дороге. Остановимся на кофе.',photo:'',cancelled:false},
      {id:'r2',driverId:'u_driver2',from:'Москва',to:'Санкт-Петербург',date:today(1),time:'12:15',seats:2,price:1850,car:'Kia Rio',pickup:'Метро Речной вокзал',dropoff:'Метро Московская',luggage:'Небольшой багаж',comment:'Не курим в салоне. Можно с небольшим чемоданом.',photo:'',cancelled:false},
      {id:'r3',driverId:'u_driver3',from:'Москва',to:'Санкт-Петербург',date:today(1),time:'17:45',seats:3,price:2400,car:'Hyundai Solaris',pickup:'Москва',dropoff:'Санкт-Петербург',luggage:'Любой разумный багаж',comment:'Можно договориться об остановке по пути.',photo:'',cancelled:false},
      {id:'r4',driverId:'u_driver1',from:'Казань',to:'Нижний Новгород',date:today(2),time:'09:00',seats:2,price:1200,car:'Toyota Camry',pickup:'Центр',dropoff:'Центр',luggage:'Средний багаж',comment:'Спокойная поездка.',photo:'',cancelled:false},
      {id:'r5',driverId:'u_driver2',from:'Тверь',to:'Москва',date:today(3),time:'07:00',seats:3,price:null,car:'Kia Rio',pickup:'Автовокзал',dropoff:'Метро Ховрино',luggage:'Небольшой багаж',comment:'Стоимость обсудим лично.',photo:'',cancelled:false},
      {id:'r6',driverId:'u_driver1',from:'Москва',to:'Тверь',date:today(-12),time:'11:00',seats:3,price:680,car:'Toyota Camry',pickup:'Москва',dropoff:'Тверь',luggage:'Средний багаж',comment:'Прошедшая поездка.',photo:'',cancelled:false},
      {id:'r7',driverId:'u_driver2',from:'Воронеж',to:'Москва',date:today(4),time:'10:00',seats:2,price:1500,car:'Kia Rio',pickup:'Воронеж',dropoff:'Москва',luggage:'Средний багаж',comment:'Отменённая поездка.',photo:'',cancelled:true}
    ],reviews:[{id:'v1',driverId:'u_driver1',author:'Екатерина',score:5,text:'Выехали вовремя, водитель вежливый, поездка прошла отлично.',date:today(-14)},{id:'v2',driverId:'u_driver1',author:'Сергей',score:5,text:'Аккуратное вождение, машина чистая, рекомендую.',date:today(-8)},{id:'v3',driverId:'u_driver2',author:'Максим',score:4,text:'Все хорошо, была небольшая задержка на выезде.',date:today(-12)},{id:'v4',driverId:'u_driver3',author:'Наталья',score:5,text:'Комфортно и спокойно, спасибо!',date:today(-11)}],messages:[],reports:[],requests:[{id:'rq_past',rideId:'r6',userId:'u_demo',status:'accepted',created:Date.now()-12*86400000},{id:'rq_cancelled',rideId:'r7',userId:'u_demo',status:'cancelled',created:Date.now()}],notifications:[],search:{from:'Москва',to:'Санкт-Петербург',date:today(1)},searchSubmitted:true,draft:null};
}
let db;
try {db = JSON.parse(localStorage.getItem(STORE)) || seed();} catch {db = seed();}
if (!db || !Array.isArray(db.users) || !Array.isArray(db.rides)) db = seed();
const save = () => {try {if (remoteMode) {localStorage.setItem('po-puti-ui-v2',JSON.stringify({search:db.search,searchSubmitted:db.searchSubmitted,draft:db.draft}));} else localStorage.setItem(STORE,JSON.stringify(db));}catch {toast('Не удалось сохранить локальные настройки.');}};
const api = async (path, method='GET', payload) => {
 const controller=typeof AbortController!=='undefined'?new AbortController():null;
 const timeoutMs=path==='/state' && method==='GET'?30000:path==='/routes/estimate'?125000:path.startsWith('/search/places?')?30000:12000;
 const timeout=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
 try {
  const res=await fetch(SERVER_BASE+'/api'+path,{method,keepalive:path==='/logout',headers:{'Content-Type':'application/json',...(accessToken&&!isCookieToken(accessToken)?{'Authorization':'Bearer '+accessToken}:{}),...(cookieSession?{'X-Po-Puti-Session':'cookie'}:{})},body:payload===undefined?undefined:JSON.stringify(payload),cache:'no-store',credentials:cookieSession?'same-origin':'omit',...(controller?{signal:controller.signal}:{})});
  let data;
  try{
   data=await res.json();
  }catch(error){
   if(error.name==='AbortError')throw error;
   const err=new Error('Сервер вернул некорректный JSON');
   if(!res.ok)err.status=res.status;
   throw err;
  }
  if(!res.ok){
   const err=new Error(typeof data?.error==='string'?data.error:'Ошибка сервера ('+res.status+')');
   err.status=res.status;
   throw err;
  }
  if(!data || typeof data!=='object' || Array.isArray(data)){
   throw new Error('Сервер вернул некорректный ответ');
  }
  return data;
 }catch(error){if(error.name==='AbortError')throw new Error('Сервер долго не отвечает. Повторите запрос.');throw error}
 finally{if(timeout)clearTimeout(timeout)}
};
let stateRefreshInFlight=null;
let stateRefreshToken='';
let lastStateSuccessAt=0;
// Only one full /state request may be in flight. A successful POST must always
// receive a *new* snapshot, even when a background refresh started before it.
async function refreshRemote({fresh=false}={}){
 if(!remoteMode)return true;
 if(stateRefreshInFlight){
   if(fresh||stateRefreshToken!==accessToken){
     await stateRefreshInFlight;
     return refreshRemote();
   }
   return stateRefreshInFlight;
 }
 const sessionToken=accessToken;
 stateRefreshToken=sessionToken;
 stateRefreshInFlight=(async()=>{
  try{
   const data=await api('/state');
   if(sessionToken!==accessToken)return false;
   const collections=['users','rides','requests','notifications','reviews','messages','reports'];
   const stringFields={
    users:['id','name','phone'],
    rides:['id','driverId','from','to','date','time'],
    requests:['id','rideId','userId','status'],
    notifications:['id','to','title','message'],
    reviews:['id','driverId','author','text','date'],
    messages:['id','rideId','fromId','toId','text'],
    reports:['id']
   };
   const validState=typeof data.currentUserId==='string' &&
    collections.every(key=>Array.isArray(data[key]) && data[key].every(item=>
     item!==null && typeof item==='object' && !Array.isArray(item) &&
     stringFields[key].every(field=>typeof item[field]==='string')
    )) && data.users.some(user=>user.id===data.currentUserId);
   if(!validState)throw new Error('Сервер вернул неполные или некорректные данные. Сохранены предыдущие данные.');
   db={...data,search:db.search||{from:'',to:'',date:''},searchSubmitted:db.searchSubmitted||false,draft:db.draft||null};
   serverError='';
   lastStateSuccessAt=Date.now();
   adminData=null;
   // A polling response must not erase form fields while the person is typing.
   const active=document.activeElement;
   const editing=['INPUT','TEXTAREA','SELECT'].includes(active?.tagName)&&active?.closest?.('form');
   if(!editing)render();
   return true;
  }catch(err){
   if(sessionToken!==accessToken)return false;
   if(err.status===401){
     expireRemoteSession();
   }
   serverError=err.message;
   const active=document.activeElement;
   const editing=['INPUT','TEXTAREA','SELECT'].includes(active?.tagName)&&active?.closest?.('form');
   if(!editing)render();
   return false;
  }
 })().finally(()=>{stateRefreshInFlight=null;stateRefreshToken=''});
 return stateRefreshInFlight;
}
function clearRemoteSession(preserveCookieMarker=false){
 pendingPushPath=null;pendingRuStoreRecipient=null;
 unsubscribeLocalPush();routeEpoch++;routeBusy=false;lastRouteDraftKey=null;clearTimeout(routeTimer);pushConfig=null;pushMessage='';v3Admin={section:'summary',page:1,q:'',status:'',from:'',to:'',data:null,key:'',loading:false,error:''};
 accessToken='';featureState.queryKey='';featureState.private=null;featureState.privateCursor=null;featureState.bus={items:[],status:'idle'};featureState.epoch++;featureState.config=null;featureState.series=null;featureState.consent=false;if(typeof nativeBridge==='function'){const bridge=nativeBridge();bridge?.closeSearch().catch(()=>{});bridge?.removeToken().catch(()=>{});if(typeof nativeSearchVisible!=='undefined')nativeSearchVisible=false;}safeStorage.removeItem(TOKEN_STORE);if(!preserveCookieMarker)safeStorage.removeItem(COOKIE_STORE);adminData=null;serverError='';
 db={currentUserId:null,users:[],rides:[],requests:[],notifications:[],reviews:[],messages:[],reports:[],search:db.search,searchSubmitted:db.searchSubmitted,draft:null};
 pubStep=1;save();
}
function expireRemoteSession(){
 const sharedRide=sharedRidePath(location.hash.slice(1))||sharedRidePath(pendingPushPath);
 clearRemoteSession();
 pendingPushPath=sharedRide;
 navigate('/login');
}
async function mutateRemote(path,payload,success){
 try{
  await api(path,'POST',payload);
  const fresh=await refreshRemote({fresh:true});
  if(success)toast(fresh?success:success+' (обновление данных временно недоступно)');
  return true;
 }catch(err){toast(err.message);return false}
};
async function demoHash(pwd){const value=DEMO_HASH_SALT+pwd;const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('')};
const me = () => db.users.find(u=>u.id === db.currentUserId);
const user = id => db.users.find(u=>u.id===id) || {name:'Участник',car:'Автомобиль не указан',phone:''};
const seatsLeft = ride => Math.max(0,ride.seats-(remoteMode&&Number.isInteger(ride.occupiedSeats)?ride.occupiedSeats:db.requests.filter(r=>r.rideId===ride.id && r.status==='accepted').length));
const myRequest = id => db.requests.find(r=>r.rideId===id && r.userId===db.currentUserId);
const unread = () => remoteMode&&Number.isInteger(db.unreadCount)?db.unreadCount:db.notifications.filter(n=>n.to===db.currentUserId&&!n.read).length;
const reviewsOf = driverId => (db.reviews||[]).filter(r=>r.driverId===driverId&&!r.isAuto&&r.isPublished!==false);
const ratingOf = driverId => {const server=user(driverId).rating;if(remoteMode&&server)return {count:server.count,avg:server.average===null?'—':Number(server.average).toFixed(1)};const arr=reviewsOf(driverId);return {count:arr.length,avg:arr.length?(arr.reduce((n,r)=>n+Number(r.score),0)/arr.length).toFixed(1):'—'}};
const ratingButton = driverId => {const r=ratingOf(driverId);return `<button type="button" class="rating-link" data-action="driver-reviews" data-id="${safe(driverId)}" aria-label="Отзывы о водителе: ${safe(r.avg)} из 5, ${r.count} отзывов">${fmtIcon('star','sm')} <strong>${r.avg}</strong><span>(${r.count})</span></button>`};
const hasConfirmedContact = (rideId,otherId) => (db.requests||[]).some(q=>q.rideId===rideId && q.status==='accepted' && ((q.userId===otherId&&db.rides.some(t=>t.id===rideId&&t.driverId===db.currentUserId))||(q.userId===db.currentUserId&&db.rides.some(t=>t.id===rideId&&t.driverId===otherId))));
const contactTools = (rideId,otherId) => {if(!hasConfirmedContact(rideId,otherId))return '';const u=user(otherId);return `<div class="actions contact-actions"><button class="btn btn-primary" data-action="open-chat" data-id="${safe(rideId)}" data-user="${safe(otherId)}">${fmtIcon('message','sm')} Написать</button>${u.phone?`<a class="btn btn-ghost" href="tel:${safe(u.phone.replace(/[^+\d]/g,''))}">${fmtIcon('phone','sm')} Позвонить</a>`:`<span class="subtle">Телефон пока не указан</span>`}</div>`};
const fmtIcon = (name, cls='') => {
 const paths={
  car:'<path d="m5 17-1 2v2M19 17l1 2v2M5 17h14l-1.5-8.4A2 2 0 0 0 15.5 7h-7a2 2 0 0 0-2 1.6L5 17Z"/><path d="M5 17v-5h14v5M8 14h.01M16 14h.01"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="m15.4 8.6-2.2 4.6-4.6 2.2 2.2-4.6 4.6-2.2Z"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  route:'<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  swap:'<path d="M7 7h14l-4-4m4 4-4 4M17 17H3l4 4m-4-4 4-4"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  pin:'<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2H3Zm14-15a3 3 0 0 1 0 6m2 9h2v-2a6 6 0 0 0-4-5.7"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  back:'<path d="m14 6-6 6 6 6M8 12h13"/>',
  luggage:'<rect x="5" y="7" width="14" height="14" rx="2"/><path d="M9 7V5a3 3 0 0 1 6 0v2M9 12v5m6-5v5"/>',
  star:'<path d="m12 2 3.1 6.4 7 .9-5.1 5 .9 7.1-5.9-3.3-5.9 3.3.9-7.1-5.1-5 7-.9L12 2Z"/>',
  edit:'<path d="m3 21 4-.7L20 7.3 16.7 4 3.7 17 3 21ZM15 6l3 3"/>',
  logout:'<path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 8l4 4-4 4m-9-4h13"/>',
  alert:'<path d="M12 3 2 21h20L12 3Zm0 7v4m0 3v.01"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
  briefcase:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  phone:'<path d="M7 3H5a2 2 0 0 0-2 2c0 9 7 16 16 16a2 2 0 0 0 2-2v-2l-5-3-2 2c-3-1-5-3-6-6l2-2-3-5Z"/>',
  refresh:'<path d="M20 8a8 8 0 0 0-14-2L3 9m0-6v6h6M4 16a8 8 0 0 0 14 2l3-3m0 6v-6h-6"/>',
  message:'<path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9.2 9.2 0 0 1-4-.9L3 21l1.9-5A9 9 0 1 1 21 11.5Z"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>'
 };
 return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.info}</svg>`;
};
const photoUrl = value => remoteMode&&typeof value==='string'&&value.startsWith('/uploads/')?SERVER_BASE+value:value;
const avatar = (u, size='') => `<span class="avatar ${size}">${u.photo?`<img src="${safe(photoUrl(u.photo))}" alt="">`:safe((u.name||'?').slice(0,1).toUpperCase())}</span>`;
const btn = (text, action, variant='primary', other='') => `<button type="button" class="btn btn-${variant}" data-action="${action}" ${other}>${text}</button>`;
let tripsTab='future', pubStep=1, modal=null, toastTimer;
function toast(msg){let e=$('.toast');if(!e){e=document.createElement('div');e.className='toast';document.body.appendChild(e)}e.textContent=msg;clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.remove(),4200)}
function navigate(path){if(location.hash === '#'+path){render();scrollTo({top:0,behavior:'smooth'});}else location.hash=path;}
function header(){const current=me();return `<header class="site-header"><a class="brand" href="#/search"><span class="brand-logo">${fmtIcon('car','lg')}</span><span>по пути<span style="color:#43caba">.</span></span></a><div class="top-actions"><button class="circle-btn" data-action="go-notifications" aria-label="Уведомления">${fmtIcon('bell')}${unread()?'<span class="dot"></span>':''}</button><button class="avatar" data-action="go-profile" aria-label="Профиль">${current?(current.photo?`<img src="${safe(photoUrl(current.photo))}" alt="">`:safe(current.name.slice(0,1))):'?'}</button></div></header>`}
function navBar(active){const tabs=[['search','search','Поиск'],['trips','car','Мои поездки'],['notifications','bell','Уведомления'],['profile','user','Профиль']];return `<nav class="bottom-nav" aria-label="Основная навигация">${tabs.map(([route,icon,label])=>`<button class="nav-link ${active===route?'active':''}" data-action="nav" data-route="/${route}" aria-label="${label}">${fmtIcon(icon)}<span>${label}</span>${route==='notifications'&&unread()?'<span class="nav-dot"></span>':''}</button>`).join('')}</nav>`}
function routeArt(){return `<svg class="route-art" viewBox="0 0 230 175" fill="none" aria-hidden="true"><path d="M8 138c70 20 72-67 137-58 38 5 39-57 71-59" stroke="#46dac8" stroke-width="2.5" stroke-dasharray="5 8" stroke-linecap="round"/><circle cx="18" cy="140" r="8" fill="#cdf77c"/><circle cx="211" cy="23" r="8" fill="#4de3d5"/><g transform="translate(85 55) rotate(-22)"><rect x="0" y="0" width="78" height="48" rx="15" fill="#eaffff"/><path d="M13 19 19 6h40l8 13" stroke="#1a244b" stroke-width="5" stroke-linejoin="round"/><rect x="11" y="18" width="57" height="23" rx="8" fill="#42d9c6"/><rect x="18" y="35" width="12" height="7" rx="3" fill="#1a244b"/><rect x="51" y="35" width="12" height="7" rx="3" fill="#1a244b"/></g></svg>`}
function cityList(){return `<datalist id="cities">${cityOptions.map(c=>`<option value="${safe(c)}"></option>`).join('')}</datalist>`}
function searchPanel(){const s=db.search||{};return `<section class="search-panel"><div class="panel-header"><h2 class="h2">Куда едем?</h2><span class="eyebrow">Найти попутчиков</span></div><form id="search-form"><div class="form-grid search-fields"><div class="route-inputs"><div class="field"><label for="search-from">Откуда</label><input required id="search-from" name="from" list="cities" autocomplete="off" placeholder="Город отправления" value="${safe(s.from)}"></div><button class="swap" type="button" data-action="swap" aria-label="Поменять города местами">${fmtIcon('swap','sm')}</button><div class="field"><label for="search-to">Куда</label><input required id="search-to" name="to" list="cities" autocomplete="off" placeholder="Город назначения" value="${safe(s.to)}"></div></div><div class="field"><label for="search-date">Когда</label><input id="search-date" name="date" type="date" ${remoteMode?'required':''} min="${today()}" value="${safe(s.date||'')}"></div><button class="btn btn-primary full-on-mobile" type="submit">${fmtIcon('search')} Найти поездку</button></div></form>${cityList()}</section>`}
function rideCard(ride, showStatus=''){const driver=user(ride.driverId), available=seatsLeft(ride);return `<article class="trip-card" role="button" tabindex="0" data-action="open-ride" data-id="${safe(ride.id)}" aria-label="Поездка ${safe(ride.from)} — ${safe(ride.to)}"><div class="trip-top"><div><div class="time">${safe(ride.time)}</div>${ride.departureOffset?`<small>UTC${safe(ride.departureOffset)}</small>`:''}<div class="date-small">${safe(dateLabel(ride.date))}</div></div><div class="trip-price">${ride.price==null?'По договорённости':money(ride.price)}<span>${ride.price==null?'Цена обсуждается':'за место'}</span></div></div><div class="trip-route"><span>${safe(ride.from)}</span><span class="line"></span><span>${safe(ride.to)}</span></div><div class="trip-footer"><div class="driver">${avatar(driver)}<div>${safe(driver.name)}<small>${safe(ride.car||'Автомобиль не указан')}</small>${ratingButton(driver.id)}</div></div><span class="seats">${fmtIcon('users','sm')} ${available} мест.</span></div>${remoteMode&&ride.statusLabel?`<p class="trip-status">${safe(ride.statusLabel)}</p>`:''}${showStatus?`<div style="margin-top:12px"><span class="pill ${safe(showStatus)}">Заявка: ${safe(statusName(showStatus))}</span></div>`:''}</article>`}
function empty(title,description,button='',route=''){return `<div class="empty"><div class="empty-icon">🛣️</div><h3>${safe(title)}</h3><p>${safe(description)}</p>${button?`<button class="btn btn-ghost" data-action="nav" data-route="${route}">${safe(button)}</button>`:''}</div>`}
function legacySearchPage(){const {from,to,date}=db.search||{};const filtered=db.rides.filter(r=>!r.cancelled && r.canChangeParticipants!==false && !r.moderationBlocked && (remoteMode||r.date>=today()) && (!from||r.from.toLowerCase().trim()===from.toLowerCase().trim())&&(!to||r.to.toLowerCase().trim()===to.toLowerCase().trim())&&(!date||r.date===date)&&seatsLeft(r)>0).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));return `<div class="page"><section class="hero"><span class="hero-tag"><span class="tag-dot"></span> Поездки по всей России</span><h1>Вместе ехать <em>лучше.</em></h1><p>Находите поездки, знакомьтесь с попутчиками и отправляйтесь в путь с комфортом.</p>${routeArt()}</section>${searchPanel()}<div class="section-title"><h2>${db.searchSubmitted?'Подходящие поездки':'Ближайшие поездки'}</h2><button class="small-link" data-action="nav" data-route="/publish">+ Создать поездку</button></div>${filtered.length?`<div class="trip-list">${filtered.map(r=>rideCard(r)).join('')}</div>`:empty('Поездок пока нет','Попробуйте изменить города или дату, либо предложите свою поездку.')}<div class="section-title"><h2>Едете на своём авто?</h2></div><div class="section-card between"><div><strong>Возьмите попутчиков</strong><div class="subtle">Опубликуйте маршрут за пару минут</div></div><button class="btn btn-dark" data-action="nav" data-route="/publish">${fmtIcon('plus')} Создать</button></div></div>`}
function searchPage(){if(!remoteMode||typeof unifiedSearchPage!=='function')return legacySearchPage();return unifiedSearchPage()}
function publicDetail(ride){const driver=user(ride.driverId),own=ride.driverId===db.currentUserId,request=myRequest(ride.id),available=seatsLeft(ride),cancelled=ride.cancelled;const mapsUrl=`https://yandex.ru/maps/?rtext=${encodeURIComponent(ride.from+'~'+ride.to)}&rtt=auto`;return `<main class="page detail-page"><button class="small-link" data-action="back">${fmtIcon('back','sm')} Назад</button><div class="page-head"><h1>Подробности поездки</h1><p class="subtle">Проверьте маршрут и условия перед заявкой</p></div><div class="detail-hero"><span class="eyebrow" style="color:#4fe0ce">Междугородняя поездка</span><div class="title-route">${safe(ride.from)}<br><span style="color:#4fe0ce">↓</span><br>${safe(ride.to)}</div><div>${fmtIcon('calendar','sm')} ${safe(dateLabel(ride.date))} · ${safe(ride.time)}</div><div class="price">${money(ride.price)}</div><small>${ride.price==null?'Уточните стоимость у водителя':'Стоимость за одно место'}</small></div>${cancelled?'<div class="warning">Поездка отменена водителем.</div>':''}<div class="section-card"><h3>Маршрут и условия</h3><div class="detail-grid"><div class="detail-data"><small>Отправление</small><strong>${safe(ride.pickup||ride.from)}</strong></div><div class="detail-data"><small>Прибытие</small><strong>${safe(ride.dropoff||ride.to)}</strong></div><div class="detail-data"><small>Свободных мест</small><strong>${available}</strong></div><div class="detail-data"><small>Багаж</small><strong>${safe(ride.luggage||'Уточните у водителя')}</strong></div></div><p class="subtle" style="margin-bottom:2px">${safe(ride.comment||'Без дополнительных комментариев')}</p><div class="navigator-plan"><div class="between"><strong>${fmtIcon('route','sm')} План поездки</strong><span class="chip">На автомобиле</span></div><div class="map-frame"><iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Карта маршрута ${safe(ride.from)} — ${safe(ride.to)}" src="${mapsUrl.replace('https://yandex.ru/maps/?','https://yandex.ru/map-widget/v1/?')}"></iframe><div class="map-fallback">Если карта не отображается, откройте её в Яндекс.Картах</div></div><div class="route-timeline"><div class="route-stop"><i></i><div><strong>${safe(ride.from)}</strong><span>Отправление · ${safe(ride.pickup||ride.from)} · ${safe(ride.time)}</span></div></div><div class="route-stop finish"><i></i><div><strong>${safe(ride.to)}</strong><span>Прибытие · ${safe(ride.dropoff||ride.to)}</span></div></div></div><a class="btn btn-dark full" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">${fmtIcon('compass')} Открыть маршрут в навигаторе</a></div></div><div class="section-card"><h3>Водитель и автомобиль</h3><div class="row">${avatar(driver)}<div><strong>${safe(driver.name)}</strong><div class="subtle">${safe(ride.car||driver.car||'Автомобиль не указан')}</div></div>${ratingButton(driver.id)}</div>${ride.photo?`<img style="width:100%;margin-top:14px;border-radius:13px;max-height:220px;object-fit:cover" src="${safe(photoUrl(ride.photo))}" alt="Фото автомобиля">`:''}${request?.status==='accepted'&&ride.phase!=='past'?`<div style="margin-top:13px">${contactTools(ride.id,driver.id)}</div>`:''}</div>${own?`<div class="section-card"><h3>Это ваша поездка</h3><p class="subtle">${ride.canChangeParticipants===false?'После отправления изменения недоступны.':'Заявки пассажиров находятся в разделе «Мои поездки».'}</p>${ride.canChangeParticipants!==false?'<button class="btn btn-dark full" data-action="nav" data-route="/trips">Посмотреть заявки</button>':''}${!cancelled&&ride.canChangeParticipants!==false?`<button class="btn btn-danger full" style="margin-top:9px" data-action="cancel-ride" data-id="${safe(ride.id)}">Отменить поездку</button>`:''}</div>`:request?`<div class="section-card"><h3>Ваша заявка</h3><span class="pill ${safe(request.status)}">${safe(statusName(request.status))}</span><p class="subtle">Повторная заявка на эту поездку не требуется.</p>${!remoteMode&&request.status==='accepted'&&tripBucket(ride,request)==='past'&&!((db.reviews||[]).some(v=>v.rideId===ride.id && (v.authorId===db.currentUserId||v.author===me()?.name)))?`<form id="review-form" class="stack" style="margin-top:14px"><h3>Оценить поездку</h3><input type="hidden" name="rideId" value="${safe(ride.id)}"><div class="field"><label>Оценка водителя</label><select name="score" required><option value="5">★★★★★ · 5</option><option value="4">★★★★☆ · 4</option><option value="3">★★★☆☆ · 3</option><option value="2">★★☆☆☆ · 2</option><option value="1">★☆☆☆☆ · 1</option></select></div><div class="field"><label>Отзыв</label><textarea name="text" required maxlength="500" placeholder="Расскажите о поездке"></textarea></div><button class="btn btn-primary full" type="submit">Опубликовать отзыв</button></form>`:''}</div>`:`<div class="section-card">${!cancelled&&available>0&&ride.canChangeParticipants!==false?`<button class="btn btn-primary full" data-action="apply" data-id="${safe(ride.id)}">${fmtIcon('check')} Отправить заявку</button>`:`<div class="warning">Заявка недоступна: ${cancelled?'поездка отменена':'свободных мест нет'}.</div>`}<p class="tiny muted">${remoteMode?'Заявка сохраняется на сервере. Оплата — вне приложения.':'Войдите в аккаунт для отправки заявки.'}</p></div>`}${lifecyclePanel(ride)}<button class="small-link" data-action="report" data-id="${safe(ride.id)}">Сообщить о проблеме</button></main>`}
function statusName(s){return ({pending:'Ожидает ответа',accepted:'Подтверждена',rejected:'Отклонена',cancelled:'Отменена',expired:'Истекла'})[s]||'Неизвестно'}
function applicationCard(req){const applicant=user(req.userId),trip=db.rides.find(t=>t.id===req.rideId);return `<div class="section-card"><div class="between"><div class="row">${avatar(applicant)}<div><strong>${safe(applicant.name)}</strong><div class="subtle">${safe(trip?.from||'')} → ${safe(trip?.to||'')}</div></div></div><span class="pill ${safe(req.status)}">${safe(statusName(req.status))}</span></div>${req.status==='pending'&&trip?.canChangeParticipants!==false?`<div class="actions" style="margin-top:13px"><button class="btn btn-primary" data-action="accept-request" data-id="${safe(req.id)}">${fmtIcon('check','sm')} Подтвердить</button><button class="btn btn-danger" data-action="reject-request" data-id="${safe(req.id)}">Отклонить</button></div>`:req.status==='accepted'?`<div style="margin-top:12px">${contactTools(trip.id,applicant.id)}</div>`:''}</div>`}
function tripBucket(ride,req){if(remoteMode&&ride.phase){if(ride.phase==='cancelled'||['cancelled','rejected','expired'].includes(req?.status))return 'cancelled';return ride.phase==='past'?'past':'future';}if(ride.cancelled||['cancelled','rejected'].includes(req?.status))return 'cancelled';const when=new Date(ride.date+'T'+ride.time+':00').getTime();return when<Date.now()?'past':'future';}
function tripsPage(){if(!me())return `<main class="page"><div class="page-head"><h1>Мои поездки</h1></div>${empty('Нужно войти','Войдите, чтобы видеть свои поездки.','Войти','/login')}</main>`;
 const list=[...db.rides.filter(r=>r.driverId===db.currentUserId).map(ride=>({ride,req:null,owner:true})),...db.requests.filter(r=>r.userId===db.currentUserId).map(req=>({ride:db.rides.find(t=>t.id===req.rideId),req,owner:false})).filter(x=>x.ride)].sort((a,b)=>(b.ride.date+'T'+b.ride.time).localeCompare(a.ride.date+'T'+a.ride.time));
 const tabs=[['future','Будущие'],['past','Прошедшие'],['cancelled','Отменённые']];const filtered=list.filter(x=>tripBucket(x.ride,x.req)===tripsTab);
 return `<main class="page trips-page"><div class="page-head"><span class="eyebrow">Ваши маршруты</span><h1>Мои поездки</h1><p class="subtle">Все поездки и заявки в одном месте</p></div><div class="segmented trips-time-tabs">${tabs.map(([t,title])=>`<button data-action="tab" data-tab="${t}" class="${tripsTab===t?'active':''}">${title} <span class="tab-count">${list.filter(x=>tripBucket(x.ride,x.req)===t).length}</span></button>`).join('')}</div>${typeof seriesManagementMarkup==='function'?seriesManagementMarkup():''}${filtered.length?filtered.map(({ride,req,owner})=>`<section class="my-trip-group">${rideCard(ride,req?.status||(ride.cancelled?'cancelled':''))}${owner&&ride.canChangeParticipants!==false?`<div class="my-trip-meta"><strong>${fmtIcon('users','sm')} Заявки: ${db.requests.filter(q=>q.rideId===ride.id).length}</strong>${db.requests.filter(q=>q.rideId===ride.id).map(applicationCard).join('')||'<p class="subtle">Заявок пока нет</p>'}</div>`:req?.status==='accepted'&&ride.phase!=='past'?contactTools(ride.id,ride.driverId):''}${lifecyclePanel(ride)}</section>`).join(''):empty('Здесь пока нет поездок',tripsTab==='future'?'Найдите поездку или опубликуйте свой маршрут.':tripsTab==='past'?'Завершённые поездки появятся здесь.':'Отменённые поездки появятся здесь.')}<button class="btn btn-primary full" style="margin-top:20px" data-action="nav" data-route="/publish">${fmtIcon('plus')} Опубликовать поездку</button></main>`;
}
function notify(to,title,message,rideId){db.notifications.unshift({id:ids(),to,title,message,rideId,read:false,created:Date.now()})}
function notificationsPage(){const items=db.notifications.filter(n=>n.to===db.currentUserId);return `<main class="page notifications-page"><div class="page-head"><span class="eyebrow">Будьте в курсе</span><h1>Уведомления</h1><p>Не прочитано: ${unread()}</p>${remoteMode?'<button class="btn btn-ghost" data-v3-action="read-all">Прочитать все</button>':''}<p class="subtle">Заявки, ответы и изменения поездок</p></div>${items.length?`<section class="section-card">${items.map(n=>`<div class="notification" role="button" tabindex="0" data-action="open-notification" data-id="${safe(n.id)}"><span class="notification-icon">${fmtIcon('bell')}</span><div><div class="between"><strong>${safe(n.title)} ${n.read?'':'●'}</strong><small class="muted">${new Date(n.created).toLocaleDateString('ru-RU')}</small></div><p>${safe(n.message)}</p></div></div>`).join('')}</section>`:empty('Пока всё спокойно','Когда появятся заявки или ответы водителя, увидите их здесь.','Искать поездку','/search')}</main>`}
function profilePage(){const current=me();if(!current)return `<main class="page profile-page">${empty('Вы не вошли','Войдите или зарегистрируйтесь.')}<button class="btn btn-primary full" data-action="login-modal">Войти / Регистрация</button></main>`;
const own=db.rides.filter(r=>r.driverId===current.id),apps=db.requests.filter(r=>r.userId===current.id),r=ratingOf(current.id);
return `<main class="page profile-page"><div class="page-head"><span class="eyebrow">Ваш аккаунт</span><h1>Профиль</h1></div><section class="section-card"><div class="profile-header">${avatar(current)}<div><h2>${safe(current.name)}</h2><p>@${safe(current.username||current.name)}</p><p class="tiny muted">ID аккаунта: ${safe(current.id)}</p></div></div><div class="stat-row"><div class="stat"><strong>${own.length}</strong><small>Маршруты</small></div><div class="stat"><strong>${apps.length}</strong><small>Заявки</small></div><div class="stat"><strong>${r.avg}</strong><small>Рейтинг</small></div></div></section>${current.role==='admin'?`<section class="section-card admin-entry"><div class="between"><div><h3>${fmtIcon('shield','sm')} Кабинет администратора</h3><p class="subtle">Пользователи, поездки, заявки и жалобы</p></div><button class="btn btn-dark" data-action="nav" data-route="/admin">Открыть</button></div></section>`:''}<section class="section-card"><h3>Личные данные</h3><form id="profile-form" class="stack"><div class="field"><label for="profile-name">Отображаемое имя</label><input id="profile-name" name="name" maxlength="60" required value="${safe(current.name)}"></div><div class="field"><label for="profile-phone">Телефон для связи после подтверждения бронирования</label><input id="profile-phone" name="phone" inputmode="tel" maxlength="24" placeholder="+7 999 123-45-67" value="${safe(current.phone||'')}"></div><div class="field"><label for="profile-car">Марка и модель автомобиля (необязательно)</label><input id="profile-car" name="car" maxlength="90" value="${safe(current.car||'')}" placeholder="Например, Skoda Octavia"></div><div class="field"><label for="profile-photo">Фото профиля (по желанию)</label><input id="profile-photo" type="file" accept="image/*"><p class="tiny muted" id="profile-photo-status" aria-live="polite">Фото с iPhone автоматически преобразуется в JPEG и сохраняется после выбора.</p></div><button class="btn btn-primary full" type="submit">${fmtIcon('check')} Сохранить изменения</button></form></section>${!remoteMode?`<section class="section-card"><h3>Тестовые аккаунты</h3><p class="subtle">Тестовые пользователи (только локально).</p><div class="actions"><button class="btn btn-ghost" data-action="switch-demo" data-user="u_demo">Мария</button><button class="btn btn-ghost" data-action="switch-demo" data-user="u_driver1">Александр</button><button class="btn btn-ghost" data-action="switch-demo" data-user="u_admin">Администратор</button></div></section>`:''}${remoteMode&&typeof privacyMarkup==='function'?privacyMarkup():''}${pushPanel()}<section class="section-card"><h3>Настройки</h3><button class="btn btn-outline full" data-action="logout">${fmtIcon('logout')} Выйти из аккаунта</button>${!remoteMode?`<button style="margin-top:9px" class="btn btn-danger full" data-action="reset-demo">Сбросить демоданные</button>`:''}</section></main>`;}
function reviewsPage(driverId){const driver=user(driverId),items=(db.reviews||[]).filter(r=>r.driverId===driverId&&r.isPublished!==false),rating=ratingOf(driverId);return `<main class="page"><button class="small-link" data-action="back">${fmtIcon('back','sm')} Назад</button><div class="page-head"><span class="eyebrow">Профиль участника</span><h1>Рейтинг и отзывы</h1></div><section class="section-card"><div class="profile-header">${avatar(driver)}<div><h2>${safe(driver.name)}</h2><p>${safe(driver.car||'Водитель')}</p></div></div><div class="rating-summary">${fmtIcon('star')} <strong>${rating.avg}</strong><span>на основе ${rating.count} отзывов</span></div></section>${items.length?items.map(x=>`<section class="section-card"><div class="between"><strong>${x.isAuto?'Системная оценка':safe(x.author||'Участник')}</strong><span class="stars">${'★'.repeat(Number(x.score))}${'☆'.repeat(5-Number(x.score))}</span></div><p>${safe(x.text)}</p>${x.isAuto?'<p class="subtle">Не входит в пользовательский рейтинг.</p>':''}<small class="muted">${safe(x.date||'')}</small></section>`).join(''):empty('Отзывов пока нет','После завершённых поездок здесь появятся оценки пассажиров.')}</main>`;}
function navigatorPage(ride){return publicDetail(ride)}
function chatPage(rideId,otherId){const ride=db.rides.find(r=>r.id===rideId),other=user(otherId);if(!ride||!hasConfirmedContact(rideId,otherId))return `<main class="page">${empty('Переписка недоступна','Чат открывается только после подтверждения заявки.','Мои поездки','/trips')}</main>`;
const items=(db.messages||[]).filter(m=>m.rideId===rideId && ((m.fromId===db.currentUserId&&m.toId===otherId)||(m.fromId===otherId&&m.toId===db.currentUserId))).sort((a,b)=>a.created-b.created);
return `<main class="page chat-page"><button class="small-link" data-action="back">${fmtIcon('back','sm')} Назад</button><div class="page-head"><span class="eyebrow">Подтверждённая поездка</span><h1>Чат с ${safe(other.name)}</h1><p class="subtle">${safe(ride.from)} → ${safe(ride.to)}</p></div><section class="section-card"><div class="message-list">${items.length?items.map(m=>`<div class="bubble ${m.fromId===db.currentUserId?'mine':''}"><p>${safe(m.text)}</p><small>${new Date(m.created).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</small></div>`).join(''):'<p class="subtle">Сообщений пока нет. Поздоровайтесь!</p>'}</div><form id="message-form" class="message-form"><input type="hidden" name="rideId" value="${safe(rideId)}"><input type="hidden" name="toId" value="${safe(otherId)}"><input name="text" required maxlength="1200" placeholder="Написать сообщение…" aria-label="Текст сообщения"><button class="btn btn-primary" type="submit">Отправить</button></form></section>${other.phone?`<a class="btn btn-ghost full" href="tel:${safe(other.phone.replace(/[^+\d]/g,''))}">${fmtIcon('phone','sm')} Позвонить ${safe(other.name)}</a>`:''}</main>`;}
function adminPage(){if(remoteMode&&me()?.role==='admin')return v3AdminPage();if(me()?.role!=='admin')return `<main class="page">${empty('Доступ закрыт','Кабинет доступен только администратору.')}</main>`;const data=remoteMode?(adminData||{users:[],rides:[],requests:[],reports:[]}):db;return `<main class="page admin-page"><div class="page-head"><span class="eyebrow">Управление сервисом</span><h1>${fmtIcon('shield')} Кабинет администратора</h1><p class="subtle">Статистика, поездки, пользователи и жалобы</p></div><div class="admin-stat-grid"><div class="stat"><strong>${data.users.length}</strong><small>Пользователей</small></div><div class="stat"><strong>${data.rides.length}</strong><small>Поездок</small></div><div class="stat"><strong>${data.requests.length}</strong><small>Заявок</small></div><div class="stat"><strong>${(data.reports||[]).length}</strong><small>Жалоб</small></div></div><section class="section-card"><h3>Последние поездки</h3>${data.rides.length?data.rides.slice(0,10).map(r=>`<div class="admin-item"><button class="small-link admin-route" data-action="open-ride" data-id="${safe(r.id)}">${safe(r.from)} → ${safe(r.to)}</button><small>${safe(r.date)} · ${r.cancelled?'Отменена':'Опубликована'}</small>${!r.cancelled?`<button class="small-link danger-link" data-action="admin-cancel" data-id="${safe(r.id)}">Отменить</button>`:''}</div>`).join(''):'<p class="subtle">Пока нет поездок</p>'}</section><section class="section-card"><h3>Пользователи</h3>${data.users.slice(0,20).map(u=>`<div class="admin-item"><span>${safe(u.name)} <small class="muted">@${safe(u.username||'')}</small></span><span class="chip">${u.role==='admin'?'Администратор':'Участник'}</span></div>`).join('')}</section><section class="section-card"><h3>Жалобы</h3>${(data.reports||[]).length?data.reports.map(x=>`<div class="admin-item"><span>${safe(x.reason)}<small class="muted">${safe(x.details||'')}</small></span><button class="small-link" data-action="open-ride" data-id="${safe(x.rideId)}">Поездка</button></div>`).join(''):'<p class="subtle">Новых жалоб нет</p>'}</section></main>`;}
function publishDraft(){return db.draft||{from:'',to:'',date:today(1),time:'09:00',seats:'2',price:'',negotiable:false,clientKey:ids(),car:me()?.car||'',pickup:'',dropoff:'',luggage:'Средний багаж',comment:'',photo:'',estimatedDurationMinutes:'',departureOffset:'+03:00',departureTimeZone:'Europe/Moscow',destinationTimeZone:'Europe/Moscow'}}
function publishPage(){if(!me()) return `<main class="page form-page"><h1>Создать поездку</h1>${empty('Нужен аккаунт','Для публикации поездки войдите в аккаунт.')}<button class="btn btn-primary full" data-action="login-modal">Войти / Регистрация</button></main>`;const d=publishDraft();if(remoteMode)queueRouteOnRender(d);return `<main class="page form-page"><button class="small-link" data-action="back">${fmtIcon('back','sm')} Назад</button><div class="page-head"><span class="eyebrow">Новый маршрут</span><h1>Опубликовать поездку</h1><p class="subtle">${d.editingRideId?'Изменение маршрута и времени: места, цена и автомобиль сохраняются.':pubStep===1?'Расскажите, куда и когда вы едете':'Проверьте данные перед публикацией'}</p></div><div class="steps"><div class="step active"></div><div class="step ${pubStep===2?'active':''}"></div></div>${pubStep===1?`<form id="publish-form"><section class="section-card"><h3>01 · Маршрут</h3><div class="stack"><div class="field"><label for="pub-from">Откуда *</label><input id="pub-from" name="from" list="cities" required maxlength="100" value="${safe(d.from)}" placeholder="Город отправления"></div><div class="field"><label for="pub-to">Куда *</label><input id="pub-to" name="to" list="cities" required maxlength="100" value="${safe(d.to)}" placeholder="Город назначения"></div><div class="two-col"><div class="field"><label for="pub-date">Дата *</label><input id="pub-date" name="date" type="date" min="${remoteMode?'':today()}" required value="${safe(d.date)}"></div><div class="field"><label for="pub-time">Время *</label><input id="pub-time" name="time" type="time" required value="${safe(d.time)}"></div></div></div></section>${remoteMode&&!d.editingRideId?seriesFormMarkup(d):''}${remoteMode?routePlannerMarkup(d):''}<section class="section-card"><h3>02 · Места и стоимость</h3><div class="two-col"><div class="field"><label for="pub-seats">Свободных мест *</label><select id="pub-seats" name="seats">${[1,2,3,4,5,6,7].map(n=>`<option value="${n}" ${Number(d.seats)===n?'selected':''}>${n}</option>`).join('')}</select></div><div class="field"><label for="pub-price">Цена за место, ₽</label><input id="pub-price" name="price" type="number" min="0" max="100000" step="1" ${d.negotiable?'disabled':''} value="${safe(d.price)}" placeholder="Например, 1800"></div></div><label class="checkbox-line" style="margin-top:12px"><input type="checkbox" name="negotiable" id="pub-negotiable" ${d.negotiable?'checked':''}> По договорённости</label></section><section class="section-card"><h3>03 · Автомобиль и детали</h3><div class="stack"><div class="field"><label for="pub-car">Автомобиль *</label><input id="pub-car" name="car" required maxlength="90" value="${safe(d.car)}" placeholder="Марка и модель"></div><div class="field"><label for="pub-pickup">Место посадки</label><input id="pub-pickup" name="pickup" maxlength="150" value="${safe(d.pickup)}" placeholder="Адрес или ориентир"></div><div class="field"><label for="pub-dropoff">Место высадки</label><input id="pub-dropoff" name="dropoff" maxlength="150" value="${safe(d.dropoff)}" placeholder="Адрес или ориентир"></div><div class="field"><label for="pub-luggage">Багаж</label><select id="pub-luggage" name="luggage">${['Средний багаж','Небольшой багаж','Любой разумный багаж','Без багажа'].map(v=>`<option ${d.luggage===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label for="pub-comment">Комментарий пассажирам</label><textarea id="pub-comment" name="comment" maxlength="550" placeholder="Условия поездки">${safe(d.comment)}</textarea></div><div class="field"><label for="pub-photo">Фото автомобиля (по желанию)</label><input type="file" id="pub-photo" accept="image/*"><p class="tiny muted" id="pub-photo-status" aria-live="polite">${d.photo?'Фото добавлено к поездке.':'Фото с iPhone будет автоматически уменьшено.'}</p>${d.photo?`<img id="pub-photo-preview" src="${safe(photoUrl(d.photo))}" alt="Предпросмотр фото автомобиля" style="display:block;max-width:100%;max-height:180px;object-fit:cover;border-radius:12px;margin-top:8px">`:'' }</div></div></section><button type="submit" class="btn btn-primary full">Продолжить ${fmtIcon('arrow')}</button><p class="subtle">Черновик сохраняется в браузере автоматически.</p></form>${cityList()}`:`<section class="section-card"><h3>Проверка маршрута</h3><div class="detail-hero"><div class="title-route">${safe(d.from)} → ${safe(d.to)}</div><div>${safe(dateLabel(d.date))} · ${safe(d.time)}</div><div class="price">${d.negotiable?'По договорённости':money(d.price)}</div></div><div class="detail-grid"><div class="detail-data"><small>Мест</small><strong>${safe(d.seats)}</strong></div><div class="detail-data"><small>Автомобиль</small><strong>${safe(d.car)}</strong></div><div class="detail-data"><small>Посадка</small><strong>${safe(d.pickup||d.from)}</strong></div><div class="detail-data"><small>Высадка</small><strong>${safe(d.dropoff||d.to)}</strong></div></div><p class="subtle">${safe(d.luggage)}. ${safe(d.comment)}</p><div class="note">После публикации поездка появится в поиске.</div></section><div class="actions"><button class="btn btn-ghost" data-action="publish-back">${fmtIcon('back')} Изменить</button><button class="btn btn-primary" data-action="publish-confirm">${fmtIcon('check')} Опубликовать поездку</button></div>`}</main>`}
function loginPage(){return `<main class="page form-page"><div class="detail-hero" style="margin-top:18px"><span class="eyebrow" style="color:var(--teal)">Добро пожаловать</span><div class="title-route">По пути —<br>едем вместе</div><div class="subtle" style="color:#c1cadc">Вход и регистрация по логину и паролю</div></div><section class="section-card"><div class="segmented"><button data-action="account-tab" data-tab="login" class="${accountTab==='login'?'active':''}">Вход</button><button data-action="account-tab" data-tab="register" class="${accountTab==='register'?'active':''}">Регистрация</button></div><form id="login-form" class="stack" style="margin-top:18px"><div class="field"><label for="reg-username">Логин *</label><input id="reg-username" name="username" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+" autocomplete="username" placeholder="Например, ivan_2026"></div><div class="field"><label for="reg-password">Пароль *</label><input id="reg-password" name="password" type="password" required minlength="8" maxlength="128" autocomplete="${accountTab==='register'?'new-password':'current-password'}" placeholder="Не менее 8 символов"></div>${accountTab==='login'?'<label class="field">Код MFA администратора (если включена)<input name="mfaCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"></label>':''}${accountTab==='register'?`<label class="checkbox-line"><input type="checkbox" name="terms" required> Согласен с <a href="${safe(SERVER_BASE)}/privacy.html" target="_blank" rel="noopener">условиями обработки данных</a></label>`:''}<button type="submit" class="btn btn-primary full">${accountTab==='register'?'Создать аккаунт':'Войти'}</button></form><p class="subtle">Подтверждение по SMS подключим позже. Телефон для связи можно добавить в профиле.</p></section>${!remoteMode?`<section class="section-card"><h3>Тестовые аккаунты</h3><p class="subtle">Для локального тестирования: <strong>maria</strong>, <strong>alex</strong> или <strong>admin-demo</strong>. Пароль у всех: <strong>demo1234</strong>.</p><p class="tiny muted">Только локальное тестирование.</p></section>`:''}</main>`;}
function render(){let hash='/search';try{hash=decodeURIComponent(location.hash.replace(/^#/,''))||'/search'}catch{hash='/search'}const route=hash.split('/')[1]||'search';const current=me();let page,active=route;
 // Provider responses can arrive between keystrokes. Preserve the live form
 // while it has focus or contains edits not yet submitted to db.search.
 const searchForm=route==='search'?$('#search-form'):null,focused=document.activeElement;
 const keepSearch=searchForm&&(searchForm.contains(focused)||['from','to','date'].some(name=>searchForm.elements.namedItem(name)?.value!==String(db.search?.[name]||'')));
 const selection=keepSearch&&searchForm.contains(focused)?{node:focused,start:focused.selectionStart,end:focused.selectionEnd}:null;
 if(!window.Capacitor&&route!=='search'&&document.querySelector('[data-yandex-web-loader]')){location.reload();return;}
 if(route==='login'){page=loginPage();active='profile'}
 else if(route==='search'){page=searchPage()}
 else if(route==='publish'){page=publishPage();active='trips'}
 else if(route==='ride'){const ride=db.rides.find(r=>r.id===hash.split('/')[2])||(current?.role==='admin'?adminData?.rides?.find(r=>r.id===hash.split('/')[2]):null);page=ride?publicDetail(ride):`<main class="page">${empty('Поездка не найдена','Возможно, её удалили или ссылка неверная.','К поиску','/search')}</main>`;active='search'}
 else if(route==='trips'){page=tripsPage()}
 else if(route==='notifications'){page=notificationsPage()}
 else if(route==='profile'){page=profilePage()}
 else if(route==='my-reviews'){page=myReviewsPage();active='profile'}
 else if(route==='complaints'){page=complaintsPage();active='profile'}
 else if(route==='reviews'){page=reviewsPage(hash.split('/')[2]);active='search'}
 else if(route==='chat'){page=chatPage(hash.split('/')[2],hash.split('/')[3]);active='trips'}
 else if(route==='admin'){page=adminPage();active='profile'}
 else {page=searchPage();active='search'}
 if(typeof preserveAds==='function')preserveAds();
 $('#app').innerHTML=`<div class="shell">${header()}<div data-android-download-host></div>${!navigator.onLine?'<div class="warning" style="margin:0 20px 12px">Нет интернета.</div>':''}${serverError?`<div class="warning" style="margin:0 20px 12px">${safe(serverError)} <button data-action="retry-sync" class="small-link">Повторить</button></div>`:''}${page}${route==='search'?'<button class="floating-create" data-action="nav" data-route="/publish">'+fmtIcon('plus')+' Поездка</button>':''}${navBar(active)}</div>`;
 if(keepSearch&&$('#search-form')){$('#search-form').replaceWith(searchForm);if(selection){selection.node.focus({preventScroll:true});if(selection.start!==null)try{selection.node.setSelectionRange(selection.start,selection.end)}catch{}}}
 if(route==='publish'&&db.draft?.editingRideId){for(const id of ['pub-seats','pub-price','pub-car','pub-negotiable','pub-luggage','pub-comment','pub-photo']){const el=$('#'+id);if(el)el.disabled=true;}}
 if(typeof restoreAds==='function')restoreAds();
 syncUnreadBadge();
  if(typeof syncAndroidDownload==='function')syncAndroidDownload();
 if(typeof syncFeatures==='function')Promise.resolve().then(syncFeatures);
 document.title='По пути · '+({search:'Поиск',publish:'Создать поездку',trips:'Мои поездки',notifications:'Уведомления',profile:'Профиль',ride:'Поездка',login:'Вход',reviews:'Отзывы',chat:'Чат',admin:'Администрирование'}[route]||'Поездки');
}
function showModal(title,body,buttons){hideModal();const el=document.createElement('div');el.className='overlay';el.id='dialog-overlay';el.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="between"><h2 id="dialog-title">${safe(title)}</h2><button class="circle-btn" aria-label="Закрыть" data-action="modal-close">${fmtIcon('x')}</button></div><p>${body}</p><div class="actions">${buttons}</div></div>`;document.body.appendChild(el);modal=el;el.querySelector('button')?.focus();}
function hideModal(){modal?.remove();modal=null;}
function noInternet(){if(!navigator.onLine){toast('Нет соединения. Повторите действие после восстановления сети.');return true}return false}
function normalizePhone(raw){const digits=String(raw).replace(/\D/g,'');if(!/^(7|8)\d{10}$/.test(digits))return null;return '+7'+digits.slice(1)}
function setDraftFromForm(){const form=$('#publish-form');if(!form)return;const d=publishDraft();const fd=new FormData(form);for(const name of ['from','to','date','time','estimatedDurationMinutes','departureOffset','departureTimeZone','destinationTimeZone','routeWaypoints','routeChangeReason','seats','price','car','pickup','dropoff','luggage','comment']){if(form.elements[name]&&!form.elements[name].disabled)d[name]=String(fd.get(name)||'').trim();}d.negotiable=Boolean(form.elements.negotiable.checked);if(form.elements.seriesMode){d.series=form.elements.seriesMode.value==='regular';d.seriesEnd=String(fd.get('seriesEnd')||'');d.weekdays=fd.getAll('weekdays').map(Number);d.exceptions=String(fd.get('exceptions')||'').split(',').map(s=>s.trim()).filter(Boolean);d.privateRide=fd.get('privateRide')==='on';}db.draft=d;save();}
function validateDraft(d){if(!d||typeof d!=='object')return 'Заполните данные поездки';if(!d.from)return 'Укажите город отправления';if(!d.to)return 'Укажите город прибытия';if(d.from.toLowerCase()===d.to.toLowerCase())return 'Города отправления и прибытия должны различаться';if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isFinite(Date.parse(d.date+'T00:00:00Z'))||new Date(d.date+'T00:00:00Z').toISOString().slice(0,10)!==d.date||(!remoteMode&&d.date<today()))return 'Выберите сегодняшнюю или будущую дату';if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.time))return 'Укажите время отправления';if(!remoteMode&&d.date===today()&&d.time<new Date().toTimeString().slice(0,5))return 'Укажите будущее время поездки';if(!Number.isInteger(Number(d.seats))||Number(d.seats)<1||Number(d.seats)>7)return 'Укажите количество свободных мест';if(!d.negotiable&&(d.price===''||!Number.isInteger(Number(d.price))||Number(d.price)<0||Number(d.price)>100000))return 'Укажите стоимость или выберите «По договорённости»';if(!d.car)return 'Укажите автомобиль';if(remoteMode&&!d.routeQuoteId)return 'Дождитесь расчёта маршрута. При ошибке уточните адрес и повторите.';if(d.series&&(!d.seriesEnd||!d.weekdays?.length||!d.privateRide))return 'Выберите период, дни недели и подтвердите частную поездку';return ''}
function openRide(id){navigate('/ride/'+encodeURIComponent(id))}
function handleAction(target){const action=target.dataset.action,id=target.dataset.id;
 switch(action){
 case 'nav':navigate(target.dataset.route);break;
 case 'go-notifications':navigate('/notifications');break;
 case 'go-profile':navigate('/profile');break;
 case 'open-ride':openRide(id);break;
 case 'back':history.length>1?history.back():navigate('/search');break;
 case 'swap':{const a=$('#search-from'),b=$('#search-to');if(a&&b){[a.value,b.value]=[b.value,a.value]};break}
 case 'tab':tripsTab=target.dataset.tab;render();break;
 case 'account-tab':accountTab=target.dataset.tab;render();break;
 case 'driver-reviews':navigate('/reviews/'+encodeURIComponent(id));break;
 case 'open-chat':navigate('/chat/'+encodeURIComponent(id)+'/'+encodeURIComponent(target.dataset.user));break;
 case 'retry-sync':refreshRemote();break;
 case 'admin-cancel':{if(me()?.role!=='admin')break;showModal('Отменить поездку?', 'Администратор отменит публикацию, участники получат уведомления.',btn('Назад','modal-close','ghost')+`<button class="btn btn-danger" data-action="admin-cancel-confirm" data-id="${safe(id)}">Отменить поездку</button>`);break;}
 case 'admin-cancel-confirm':{if(remoteMode){hideModal();mutateRemote('/admin/rides/'+encodeURIComponent(id)+'/cancel',{},'Поездка отменена');break;}const r=db.rides.find(r=>r.id===id);if(r){r.cancelled=true;db.requests.filter(q=>q.rideId===id&&q.status==='accepted').forEach(q=>{q.status='cancelled';notify(q.userId,'Поездка отменена','Администратор отменил поездку',id)});save();}hideModal();render();break;}
 case 'open-notification':{const note=db.notifications.find(n=>n.id===id);if(note){note.read=true;save();if(remoteMode)mutateRemote('/notifications/'+encodeURIComponent(id)+'/read',{});note.targetPath?navigate(safePushPath(note.targetPath)):note.rideId?openRide(note.rideId):render()}break;}
 case 'apply':{if(!me()){navigate('/login');break;}if(noInternet())break;const ride=db.rides.find(r=>r.id===id);if(!ride||ride.cancelled||seatsLeft(ride)<1){toast('Поездка недоступна');break;}if(ride.driverId===db.currentUserId){toast('Нельзя отправить заявку на собственную поездку');break;}if(myRequest(id)){toast('Вы уже отправили заявку');break;}
 showModal('Отправить заявку?',`<strong>${safe(ride.from)} → ${safe(ride.to)}</strong><br>${safe(dateLabel(ride.date))}, ${safe(ride.time)}<br>Стоимость: ${money(ride.price)}<br><span class="subtle">${remoteMode?'Водитель увидит заявку в своём аккаунте.':'Водитель увидит вашу заявку.'}</span>`,btn('Отмена','modal-close','ghost')+`<button class="btn btn-primary" data-action="apply-confirm" data-id="${safe(id)}">Отправить заявку</button>`);break;}
 case 'apply-confirm':{if(noInternet())break;if(remoteMode){hideModal();mutateRemote('/requests',{rideId:id},'Заявка отправлена');break;}const r=db.rides.find(t=>t.id===id);if(!r||r.cancelled||!seatsLeft(r)||myRequest(id)||r.driverId===db.currentUserId){hideModal();toast('Отправка уже выполнена или невозможна');break;}db.requests.push({id:ids(),rideId:id,userId:db.currentUserId,status:'pending',created:Date.now()});notify(r.driverId,'Новая заявка',`${me().name} хочет поехать: ${r.from} → ${r.to}`,r.id);save();hideModal();toast('Заявка отправлена! Ожидайте решения водителя.');render();break;}
 case 'accept-request':{if(noInternet())break;if(remoteMode){mutateRemote('/requests/'+encodeURIComponent(id)+'/accept',{},'Заявка подтверждена');break;}const req=db.requests.find(r=>r.id===id),r=req&&db.rides.find(t=>t.id===req.rideId);if(!req||!r||r.driverId!==db.currentUserId||req.status!=='pending'||!seatsLeft(r)||r.cancelled){toast('Невозможно подтвердить заявку');break;}req.status='accepted';notify(req.userId,'Заявка подтверждена',`${r.from} → ${r.to}: водитель принял вашу заявку`,r.id);save();toast('Заявка подтверждена');render();break;}
 case 'reject-request':{const req=db.requests.find(r=>r.id===id),r=req&&db.rides.find(t=>t.id===req.rideId);if(!req||!r||r.driverId!==db.currentUserId||req.status!=='pending')break;showModal('Отклонить заявку?','Пассажир получит уведомление об отказе.',btn('Не отклонять','modal-close','ghost')+`<button class="btn btn-danger" data-action="reject-confirm" data-id="${safe(id)}">Отклонить заявку</button>`);break;}
 case 'reject-confirm':{if(noInternet())break;if(remoteMode){hideModal();mutateRemote('/requests/'+encodeURIComponent(id)+'/reject',{},'Заявка отклонена');break;}const req=db.requests.find(r=>r.id===id),r=req&&db.rides.find(t=>t.id===req.rideId);if(!req||!r||r.driverId!==db.currentUserId||req.status!=='pending'){hideModal();break;}req.status='rejected';notify(req.userId,'Заявка отклонена',`${r.from} → ${r.to}: водитель отклонил заявку`,r.id);save();hideModal();toast('Заявка отклонена');render();break;}
 case 'cancel-ride':{const r=db.rides.find(t=>t.id===id);if(!r||r.driverId!==db.currentUserId||r.cancelled)break;showModal('Отменить поездку?',`Маршрут ${safe(r.from)} → ${safe(r.to)} будет отменён. Участники получат уведомления.`,btn('Оставить поездку','modal-close','ghost')+`<button class="btn btn-danger" data-action="cancel-confirm" data-id="${safe(id)}">Отменить поездку</button>`);break;}
 case 'cancel-confirm':{if(noInternet())break;if(remoteMode){hideModal();mutateRemote('/rides/'+encodeURIComponent(id)+'/cancel',{},'Поездка отменена');break;}const r=db.rides.find(t=>t.id===id);if(!r||r.driverId!==db.currentUserId||r.cancelled){hideModal();break;}r.cancelled=true;for(const req of db.requests.filter(q=>q.rideId===id&&['pending','accepted'].includes(q.status))){req.status='cancelled';notify(req.userId,'Поездка отменена',`${r.from} → ${r.to}: водитель отменил поездку`,r.id)}save();hideModal();toast('Поездка отменена');render();break;}
 case 'publish-back':pubStep=1;render();break;
 case 'publish-confirm':{if(imageProcessing){toast('Подождите завершения обработки фото');break;}if(noInternet())break;if(remoteMode){if(publishing)return;const d=db.draft||{};const err=validateDraft(d);if(err){pubStep=1;render();toast(err);break;}if(!d.clientKey){d.clientKey=ids();db.draft=d;save();}publishing=true;const publishToken=accessToken;api(d.editingSeriesId?'/series/'+encodeURIComponent(d.editingSeriesId)+'/update':d.editingRideId?'/rides/'+encodeURIComponent(d.editingRideId)+'/route':d.series?'/series':'/rides','POST',{...d,reason:d.routeChangeReason||'Водитель обновил маршрут или время через форму поездки',departureOffset:d.departureTimeZone?undefined:d.departureOffset,departureAt:d.departureTimeZone?undefined:d.date+'T'+d.time+':00'+(d.departureOffset||'+03:00'),estimatedDurationMinutes:Number(d.estimatedDurationMinutes),clientKey:d.clientKey}).then(data=>{if(publishToken!==accessToken)return;db.draft=null;featureState.series=null;pubStep=1;save();return refreshRemote({fresh:true}).then(fresh=>{
 const firstId=data.rides?.[0]?.id||data.id;if(fresh&&db.rides.some(r=>r.id===firstId)){if(data.seriesId)toast('Создано поездок: '+data.rides.length);openRide(firstId);}
 else toast('Поездка создана. Обновление данных временно недоступно — проверьте «Мои поездки» после восстановления связи.');
})}).catch(e=>toast(e.message)).finally(()=>{publishing=false});break;}const d=db.draft||{},err=validateDraft(d);if(err){pubStep=1;render();toast(err);break;}const r={id:ids(),driverId:db.currentUserId,from:d.from,to:d.to,date:d.date,time:d.time,seats:Number(d.seats),price:d.negotiable?null:Number(d.price),car:d.car,pickup:d.pickup,dropoff:d.dropoff,luggage:d.luggage,comment:d.comment,photo:d.photo||'',cancelled:false};db.rides.unshift(r);db.draft=null;pubStep=1;save();toast('Поездка опубликована в демоверсии');openRide(r.id);break;}
 case 'modal-close':hideModal();break;
 case 'switch-demo':{const u=db.users.find(x=>x.id===target.dataset.user);if(!u)break;db.currentUserId=u.id;save();hideModal();tripsTab='future';toast('Вы вошли как '+u.name);navigate('/search');break;}
 case 'logout':{showModal('Выйти из аккаунта?','Вы сможете войти снова по логину и паролю.',btn('Остаться','modal-close','ghost')+btn('Выйти','logout-confirm','danger'));break;}
 case 'logout-confirm':{pendingPushPath=null;if(remoteMode){if(accessToken)api('/logout','POST',{deviceId:pushDeviceId()}).catch(()=>{});unsubscribeLocalPush();clearRemoteSession();}else{db.currentUserId=null;save();}hideModal();navigate('/login');break;}
 case 'login-modal':navigate('/login');break;
 case 'reset-demo':showModal('Сбросить демонстрацию?','Все добавленные поездки, заявки и настройки в этом браузере будут удалены.',btn('Отмена','modal-close','ghost')+btn('Сбросить','reset-confirm','danger'));break;
 case 'reset-confirm':db=seed();save();hideModal();navigate('/search');toast('Демонстрационные данные сброшены');break;
 case 'report':{const r=db.rides.find(r=>r.id===id);if(!r)break;showModal('Сообщить о проблеме',`<form id="report-form" class="stack"><input type="hidden" name="rideId" value="${safe(id)}"><label class="field">Причина<select name="reason"><option>Неверные данные о поездке</option><option>Неподобающее поведение</option><option>Мошенничество</option><option>Другое</option></select></label><label class="field">Комментарий<textarea name="details" maxlength="500"></textarea></label><button class="btn btn-primary full" type="submit">Отправить жалобу</button></form>`,btn('Закрыть','modal-close','ghost'));break;}
 }
}
document.addEventListener('click',ev=>{const el=ev.target.closest('[data-action]');if(!el)return;ev.preventDefault();handleAction(el)});
document.addEventListener('keydown',ev=>{if((ev.key==='Enter'||ev.key===' ')&&ev.target.matches('[role="button"][data-action]')){ev.preventDefault();handleAction(ev.target)}if(ev.key==='Escape')hideModal()});
document.addEventListener('submit',ev=>{const form=ev.target;if(!['search-form','publish-form','profile-form','login-form','message-form','report-form','review-form'].includes(form.id))return;ev.preventDefault();
 if(form.id==='search-form'){const data=new FormData(form);const from=String(data.get('from')||'').trim(),to=String(data.get('to')||'').trim();if(!from||!to){toast('Укажите оба города');return;}db.search={from,to,date:String(data.get('date')||'')};db.searchSubmitted=true;featureState.queryKey='';save();render();runUnifiedSearch();return;}
 if(form.id==='publish-form'){if(imageProcessing){toast('Подождите, пока фотография обработается');return;}setDraftFromForm();const error=validateDraft(db.draft);if(error){toast(error);return;}pubStep=2;render();scrollTo(0,0);return;}
 if(form.id==='profile-form'){const fd=new FormData(form),name=String(fd.get('name')||'').trim(),car=String(fd.get('car')||'').trim(),phone=String(fd.get('phone')||'').trim();if(!name){toast('Укажите имя');return;}if(remoteMode){mutateRemote('/profile',{name,car,phone},'Профиль сохранён');return;}me().name=name;me().car=car;me().phone=phone;save();toast('Профиль сохранён');render();return;}
 if(form.id==='login-form'){const fd=new FormData(form),username=String(fd.get('username')||'').trim().toLowerCase(),password=String(fd.get('password')||'');if(!/^[a-z0-9_-]{3,32}$/.test(username)){toast('Логин: 3–32 латинские буквы, цифры, _ или -');return;}if(password.length<8){toast('Пароль должен быть не короче 8 символов');return;}if(remoteMode){api(accountTab==='register'?'/register':'/login','POST',{username,password,clientVersion:5,termsAccepted:accountTab==='register'&&fd.get('terms')==='on',mfaCode:String(fd.get('mfaCode')||'')}).then(data=>{accessToken=cookieSession?'cookie:'+ids():data.token;if(cookieSession){safeStorage.removeItem(TOKEN_STORE);safeStorage.setItem(COOKIE_STORE,accessToken)}else persistNativeSession(accessToken);db.currentUserId=data.user.id;serverError='';refreshRemote({fresh:true}).then(()=>{navigate(consumePendingPushPath()||'/search')})}).catch(e=>toast(e.message));return;}demoHash(password).then(hash=>{let u=db.users.find(u=>u.username===username);if(accountTab==='register'){if(!fd.get('terms')){toast('Подтвердите согласие');return;}if(u){toast('Такой логин уже занят');return;}u={id:ids(),username,passwordHash:hash,name:username,car:'',phone:'',photo:'',role:'user'};db.users.push(u)}else if(!u||u.passwordHash!==hash){toast('Неверный логин или пароль');return;}db.currentUserId=u.id;save();toast('Вход выполнен в демоверсии');navigate('/search')}).catch(()=>toast('Для проверки входа откройте демоверсию по HTTPS или localhost'));return;}
 if(form.id==='message-form'){const fd=new FormData(form),rideId=String(fd.get('rideId')),toId=String(fd.get('toId')),message=String(fd.get('text')||'').trim();if(!message||!hasConfirmedContact(rideId,toId))return;if(remoteMode){mutateRemote('/messages',{rideId,toId,text:message},'Сообщение отправлено');return;}db.messages.push({id:ids(),rideId,fromId:db.currentUserId,toId,text:message,created:Date.now()});notify(toId,'Новое сообщение',message.slice(0,120),rideId);save();render();return;}
 if(form.id==='review-form'){const fd=new FormData(form),rideId=String(fd.get('rideId')),score=Number(fd.get('score')),text=String(fd.get('text')||'').trim();if(!text)return;if(remoteMode){mutateRemote('/reviews',{rideId,score,text},'Отзыв опубликован');return;}const trip=db.rides.find(r=>r.id===rideId);if(!trip||!myRequest(rideId)||myRequest(rideId).status!=='accepted'){toast('Нельзя оставить отзыв');return;}if((db.reviews||[]).some(r=>r.rideId===rideId&&r.authorId===db.currentUserId)){toast('Вы уже оставили отзыв');return;}db.reviews.push({id:ids(),rideId,driverId:trip.driverId,authorId:db.currentUserId,author:me().name,score,text,date:today()});save();toast('Отзыв опубликован');render();return;}
 if(form.id==='report-form'){const fd=new FormData(form),rideId=String(fd.get('rideId')),reason=String(fd.get('reason')),details=String(fd.get('details')||'').trim();if(remoteMode){mutateRemote('/reports',{rideId,reason,details},'Жалоба отправлена');hideModal();return;}db.reports.push({id:ids(),rideId,userId:db.currentUserId,reason,details,created:Date.now()});save();hideModal();toast('Жалоба отправлена администратору');render();return;}

});
document.addEventListener('input',ev=>{if(ev.target.closest('#publish-form')){setDraftFromForm();if(ev.target.id==='pub-negotiable'){const p=$('#pub-price');if(p)p.disabled=ev.target.checked;}}});
let imageProcessing=false;
async function compressPhoto(file, maxChars=155000) {
 // iPhone photos may be HEIC/HEIF; Safari can decode them and we store JPEG.
 const type=String(file.type||'').toLowerCase();
 const ext=String(file.name||'').split('.').pop().toLowerCase();
 const allowedTypes=['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif'];
 const allowedExt=['jpg','jpeg','png','webp','heic','heif'];
 if(!allowedTypes.includes(type)&&!(type===''&&allowedExt.includes(ext)))throw Error('Выберите изображение JPEG, PNG, WebP или HEIC');
 if(file.size>20*1024*1024)throw Error('Фотография слишком большая (более 20 МБ)');
 const objectUrl=URL.createObjectURL(file);
 try {
   const picture=new Image();
   await new Promise((resolve,reject)=>{
     picture.onload=resolve;
     picture.onerror=()=>reject(new Error('iPhone не смог открыть фото. В приложении «Фото» выберите «Поделиться» → сохраните копию в JPEG и попробуйте её.'));
     picture.src=objectUrl;
   });
   if(!picture.naturalWidth||!picture.naturalHeight)throw Error('Не удалось определить размер фотографии');
   const canvas=document.createElement('canvas');
   const ctx=canvas.getContext('2d');
   if(!ctx)throw Error('Обработка фото недоступна на устройстве');
   for(const edge of [720,640,540,460,380,300]) {
     const scale=Math.min(1,edge/Math.max(picture.naturalWidth,picture.naturalHeight));
     canvas.width=Math.max(1,Math.round(picture.naturalWidth*scale));
     canvas.height=Math.max(1,Math.round(picture.naturalHeight*scale));
     ctx.drawImage(picture,0,0,canvas.width,canvas.height);
     for(const quality of [0.82,0.72,0.6,0.46,0.34]){
       const result=canvas.toDataURL('image/jpeg',quality);
       if(result.startsWith('data:image/jpeg;base64,') && result.length<maxChars)return result;
     }
   }
   throw Error('Не получилось уменьшить фото. Выберите другое изображение');
 }finally{URL.revokeObjectURL(objectUrl)}
}
document.addEventListener('change',async ev=>{
 const input=ev.target;
 if(input.id!=='profile-photo'&&input.id!=='pub-photo')return;
 const file=input.files?.[0];
 if(!file)return;
 if(imageProcessing){toast('Подождите, предыдущая фотография ещё обрабатывается');return}
 imageProcessing=true;
 input.disabled=true;
 const imageUserId=db.currentUserId;
 const imageToken=accessToken;
 const isAvatar=input.id==='profile-photo';
 const status=$('#'+(isAvatar?'profile-photo-status':'pub-photo-status'));
 if(status)status.textContent='Обрабатываем фотографию…';
 try {
   const photo=await compressPhoto(file,isAvatar?180000:145000);
   if(imageUserId!==db.currentUserId||imageToken!==accessToken)return;
   if(isAvatar){
     if(!me())throw Error('Сначала войдите в аккаунт');
     if(remoteMode){
       const saved=await mutateRemote('/profile',{name:me().name,car:me().car||'',phone:me().phone||'',photo},'Фото профиля сохранено');
       if(!saved)throw Error('Не удалось сохранить фото на сервере');
     }else{me().photo=photo;save();render();toast('Фото профиля сохранено')}
   }else{
     // Keep existing fields and the image together in the local draft.
     setDraftFromForm();
     const draft=publishDraft();
     draft.photo=photo;
     db.draft=draft;
     save();
     const preview=$('#pub-photo-preview');
     if(preview)preview.src=photo;
     else if(status){
       const img=document.createElement('img');
       img.id='pub-photo-preview';img.src=photo;img.alt='Предпросмотр фото автомобиля';
       img.style.cssText='display:block;max-width:100%;max-height:180px;object-fit:cover;border-radius:12px;margin-top:8px';
       status.insertAdjacentElement('afterend',img);
     }
     if(status)status.textContent='Фото готово и будет добавлено при публикации поездки.';
     toast('Фото автомобиля готово');
   }
 }catch(err){
   if(status)status.textContent='Ошибка: '+(err.message||'Не удалось загрузить фотографию');
   toast(err.message||'Не удалось загрузить фотографию');
 }finally{
   imageProcessing=false;
   input.disabled=false;
   input.value='';
 }
});
// The same route planner is packaged into PWA and Android; provider keys stay on API.
const ROUTE_ZONES=['Europe/Kaliningrad','Europe/Moscow','Europe/Samara','Asia/Yekaterinburg','Asia/Omsk','Asia/Novosibirsk','Asia/Krasnoyarsk','Asia/Irkutsk','Asia/Yakutsk','Asia/Vladivostok','Asia/Magadan','Asia/Kamchatka','UTC'];
let routeEpoch=0,routeTimer,routeBusy=false,lastRouteDraftKey;
function queueRouteOnRender(d){if(!d.from||!d.to||!d.date||!d.time||d.routeQuoteId)return;const key=routeDraftKey(d);if(lastRouteDraftKey===key)return;lastRouteDraftKey=key;Promise.resolve().then(calculateRoute)}
function zoneSelect(name,value){return `<label class="field">${name==='departureTimeZone'?'Часовой пояс отправления':'Часовой пояс прибытия'}<select name="${name}">${[...new Set([...ROUTE_ZONES,value].filter(Boolean))].map(z=>`<option ${z===value?'selected':''}>${safe(z)}</option>`).join('')}</select></label>`}
function routePlannerMarkup(d){return `<div id="route-estimate" aria-live="polite">${routeResultMarkup(d)}</div>`}
function routeResultMarkup(d){if(routeBusy)return '<p role="status" class="subtle">Рассчитываем поездку…</p>';if(d.routeQuoteId)return '';if(!d.routeError)return '';return `<div class="note"><p>Не удалось рассчитать поездку. Уточните адреса или повторите попытку.</p>${d.routeChoices?`<label class="field">Уточните адрес<select id="route-point-choice"><option value="">Выберите адрес</option>${d.routeChoices.items.map((p,i)=>`<option value="${i}">${safe(p.address)}</option>`).join('')}</select></label>`:''}<button type="button" class="btn btn-ghost" data-v4-action="calculate-route">Повторить</button></div>`}
function refreshRoutePlanner(){const el=$('#route-estimate');if(el)el.innerHTML=routeResultMarkup(publishDraft())}
function routeQueries(d){const coordinate=/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/;return [d.pickup?(coordinate.test(d.pickup)?d.pickup:d.from+', '+d.pickup):d.from,...String(d.routeWaypoints||'').split('\n').map(s=>s.trim()).filter(Boolean),d.dropoff?(coordinate.test(d.dropoff)?d.dropoff:d.to+', '+d.dropoff):d.to]}
function routeDraftKey(d){return JSON.stringify([d.from,d.to,d.pickup,d.dropoff,d.date,d.time,d.routeWaypoints])}
function invalidateRoute(){routeEpoch++;routeBusy=false;const d=publishDraft();delete d.routeQuoteId;delete d.routeResult;delete d.routePoints;delete d.routeChoices;d.routeError='Маршрут изменён. Выполняем новый расчёт.';db.draft=d;save();refreshRoutePlanner()}
async function calculateRoute(){if(!remoteMode||!accessToken||!$('#publish-form'))return;setDraftFromForm();let d=publishDraft();if(!d.from||!d.to||!d.date||!d.time)return;const epoch=++routeEpoch,token=accessToken,key=routeDraftKey(d);routeBusy=true;d.routeChoices=null;refreshRoutePlanner();const stopTimer=setTimeout(()=>{if(epoch!==routeEpoch||token!==accessToken)return;routeEpoch++;routeBusy=false;const current=publishDraft();current.routeError='Расчёт занял слишком много времени. Повторите запрос или укажите длительность вручную.';db.draft=current;save();refreshRoutePlanner()},130000);const same=()=>epoch===routeEpoch&&token===accessToken&&routeDraftKey(publishDraft())===key;
 try{const points=[];for(const query of routeQueries(d)){if(d.selectedRoutePoints?.[query]){points.push(d.selectedRoutePoints[query]);continue}const found=await api('/places?q='+encodeURIComponent(query));if(!same())return;if(!found.items?.length)throw Error(found.reason||'Точка не найдена: '+query+'. Уточните адрес или используйте ручную длительность.');if(found.items.length>1){d.routeChoices={query,items:found.items};throw Error('Выберите точный адрес для дорожного расчёта.')}points.push(found.items[0])}
  const result=await api('/routes/estimate','POST',{...d,routePoints:points,departureOffset:undefined});if(!same())return;d=publishDraft();d.routePoints=points;d.departureTimeZone=result.departureTimeZone;d.destinationTimeZone=result.destinationTimeZone;
  if(!result.available)throw Error(result.reason);d.routeQuoteId=result.routeQuoteId;d.routeResult=result;d.estimatedDurationMinutes=String(result.durationMinutes);d.routeError='';
 }catch(e){if(same()){d=publishDraft();delete d.routeQuoteId;delete d.routeResult;d.routeError=e.message}}finally{clearTimeout(stopTimer);if(same()){routeBusy=false;db.draft=d;save();refreshRoutePlanner()}}
}
function plannedTime(value,zone,offset){if(zone){try{const date=new Date(value);return new Intl.DateTimeFormat('ru-RU',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date)+' '+zone}catch{}}return tripTime(value,offset||'+00:00')}
function beginRouteEdit(id){const r=db.rides.find(r=>r.id===id);if(!r||r.driverId!==db.currentUserId||!r.canChangeParticipants)return;db.draft={...r,routePoints:undefined,editingRideId:r.id,clientKey:ids(),price:r.price??'',negotiable:r.price===null,estimatedDurationMinutes:String(r.estimatedDurationMinutes||''),departureTimeZone:r.departureTimeZone||'Europe/Moscow',destinationTimeZone:r.destinationTimeZone||'Europe/Moscow',routeWaypoints:(r.routePoints||[]).slice(1,-1).map(p=>p.address).join('\n')};pubStep=1;save();navigate('/publish')}
document.addEventListener('click',e=>{const el=e.target.closest('[data-v4-action]');if(!el)return;if(el.dataset.v4Action==='calculate-route'){clearTimeout(routeTimer);calculateRoute()}if(el.dataset.v4Action==='edit-route')beginRouteEdit(el.dataset.id)});
document.addEventListener('change',e=>{if(e.target.id!=='route-point-choice'||e.target.value==='')return;const d=publishDraft(),choice=d.routeChoices;if(!choice)return;d.selectedRoutePoints={...(d.selectedRoutePoints||{}),[choice.query]:choice.items[Number(e.target.value)]};db.draft=d;save();calculateRoute()});
document.addEventListener('input',e=>{if(!e.target.closest('#publish-form'))return;if(['from','to','pickup','dropoff','date','time','routeWaypoints'].includes(e.target.name)){invalidateRoute();clearTimeout(routeTimer);routeTimer=setTimeout(calculateRoute,700)}else if(['departureTimeZone','destinationTimeZone'].includes(e.target.name)){invalidateRoute();const d=publishDraft();d.routeError='Часовой пояс изменён. Используется ручная длительность; проверьте соответствие месту отправления.';db.draft=d;save();refreshRoutePlanner()}});

// Shared PWA/Capacitor UI. Every eligibility/status/deadline below comes from API.
const OUTCOME_LABELS={pending_confirmation:'Ожидает подтверждения',completed:'Состоялась',not_held:'Не состоялась',disputed:'Спорная',unverified:'Не подтверждена',cancelled:'Отменена'};
let v3Admin={section:'summary',page:1,q:'',status:'',from:'',to:'',data:null,key:'',loading:false,error:''};
function sharedRidePath(value){return typeof value==='string'&&/^\/ride\/[a-zA-Z0-9_-]+\/?$/.test(value)?value.replace(/\/$/,''):null}
// Preserve one shared ride URL through login, including a direct /ride/id link.
let pendingPushPath=sharedRidePath(location.hash.slice(1)||location.pathname)||(/^#\/(?:chat\/|reviews\/|notifications|complaints|admin)/.test(location.hash||'')?(location.hash||'').slice(1):null);
let pushConfig=null,pushLoading=false,pushMessage='',nativePush=null,nativePushBound=false;
function participationFor(id){return (db.participations||[]).find(p=>p.rideId===id)}
function tripTime(value,offset='+00:00'){const sign=offset[0]==='-'?-1:1;const parts=offset.slice(1).split(':').map(Number);return new Date(Date.parse(value)+sign*(parts[0]*60+parts[1])*60000).toISOString().slice(0,16).replace('T',' ')+' UTC'+offset}
function lifecyclePanel(r){
 if(!remoteMode||!r.phase)return '';
 const p=participationFor(r.id),mine=(db.reviews||[]).filter(v=>v.rideId===r.id&&v.authorId===db.currentUserId);
 const pending=(p?.reviewTargets||[]).filter(t=>t.state==='pending_by_user');
 return `<section class="section-card lifecycle-panel"><h3>${safe(p?.statusLabel||r.statusLabel||OUTCOME_LABELS[r.outcome]||'Статус поездки')}</h3><p class="subtle">${r.phase==='in_progress'?'Расчётная стадия не подтверждает физический выезд.':''}${r.estimatedArrivalAt?' Расчётное прибытие: '+safe(plannedTime(r.estimatedArrivalAt,r.destinationTimeZone,r.departureOffset))+(['manual','driver_manual'].includes(r.etaSource)?' (длительность указана водителем).':' (оценка по дороге).') :' Время прибытия старой поездки неизвестно; автоматические оценки выключены.'}</p>${p?.canConfirm?`<div class="actions"><button class="btn btn-primary" data-v3-action="yes" data-id="${safe(r.id)}">Да, состоялась</button><button class="btn btn-ghost" data-v3-action="no" data-id="${safe(r.id)}">Нет, не состоялась</button></div>`:p?.answer?`<p>Ваш ответ: <strong>${p.answer==='yes'?'Да':'Нет'}</strong></p>`:''}${pending.length?`<p class="note">Вы ещё не отправили отзыв.</p>${pending.map(t=>`<button class="btn btn-ghost" data-v3-action="review" data-id="${safe(r.id)}" data-target="${safe(t.userId)}">Оценить: ${safe(user(t.userId).name)}</button>`).join('')}`:''}${mine.map(v=>`<div class="note"><strong>${safe(v.source==='automatic'?'Системная оценка':v.isPublished?'Отзыв опубликован':v.moderationStatus==='blocked'?'Отзыв скрыт модерацией':'Отзыв ожидает публикации')}</strong><p>${'★'.repeat(Number(v.score))} ${safe(v.text)}</p>${!v.isPublished&&v.visibleAfterAt?`<small>Не раньше ${safe(new Date(v.visibleAfterAt).toLocaleString('ru-RU'))}; для публикации поездка должна быть подтверждена.</small>`:''}</div>`).join('')}${r.driverId===db.currentUserId&&r.canChangeParticipants?`<button class="btn btn-ghost" data-v4-action="edit-route" data-id="${safe(r.id)}">Изменить маршрут и время</button>`:''}${p&&r.phase==='past'?`<button class="small-link" data-v3-action="complaint" data-id="${safe(r.id)}">Обратиться по факту поездки</button>`:''}</section>`;
}
function openV3Review(rideId,target){
 const p=participationFor(rideId),pending=(p?.reviewTargets||[]).filter(t=>t.state==='pending_by_user');
 if(!pending.length){toast('Срок закрыт или отзыв уже отправлен');return}
 const selected=target||pending[0].userId;
 showModal('Оцените поездку',`<form id="v3-review-form" class="stack"><input type="hidden" name="rideId" value="${safe(rideId)}"><label class="field">Участник<select name="targetUserId">${pending.map(t=>`<option value="${safe(t.userId)}" ${t.userId===selected?'selected':''}>${safe(user(t.userId).name)}</option>`).join('')}</select></label><label class="field">Оценка<select name="score" required>${[5,4,3,2,1].map(n=>`<option value="${n}">${'★'.repeat(n)} · ${n}</option>`).join('')}</select></label><label class="field">Текст (необязательно)<textarea name="body" maxlength="500"></textarea></label><p class="warning">После отправки изменить или удалить отзыв будет невозможно. Опубликуем его через 7 дней</p><button class="btn btn-primary" type="submit">Отправить отзыв</button></form>`,btn('Позже','modal-close','ghost'));
}
function myReviewsPage(){const items=(db.reviews||[]).filter(r=>r.authorId===db.currentUserId);return `<main class="page"><h1>Мои отзывы</h1>${items.length?items.map(v=>`<section class="section-card"><h3>${safe(user(v.targetUserId||v.driverId).name)}</h3><p>${'★'.repeat(Number(v.score))} ${safe(v.text)}</p><p>${v.isAuto?'Оценка выставлена автоматически; не участвует в пользовательском рейтинге':v.isPublished?'Опубликован':v.moderationStatus==='blocked'?'Скрыт модерацией':'Ожидает публикации'}</p>${!v.isPublished&&v.visibleAfterAt?`<p class="subtle">Не раньше ${safe(new Date(v.visibleAfterAt).toLocaleString('ru-RU'))}; также требуется подтверждение поездки.</p>`:''}</section>`).join(''):empty('Отзывов пока нет','Ответьте «Да» после поездки, чтобы сразу открыть форму отзыва.')}${db.rides.filter(r=>(participationFor(r.id)?.reviewTargets||[]).some(t=>t.state==='pending_by_user')).map(lifecyclePanel).join('')}</main>`}
function complaintsPage(){return `<main class="page"><h1>Мои обращения</h1>${(db.decisions||[]).map(d=>`<section class="section-card"><h3>Решение: ${safe(OUTCOME_LABELS[d.decision]||'Обращение закрыто')}</h3><p>${safe(d.comment)}</p><small>${safe(new Date(d.createdAt).toLocaleString('ru-RU'))}</small></section>`).join('')}${(db.reports||[]).map(r=>`<section class="section-card"><h3>${safe(r.reason)}</h3><p>${safe(r.details)}</p><p>${r.status==='resolved'?'Рассмотрено: '+safe(OUTCOME_LABELS[r.decision]||'Закрыто'):'На рассмотрении'}</p></section>`).join('')||empty('Обращений пока нет','Обращение можно отправить из карточки поездки.')}</main>`}
function pushDeviceId(){let id=safeStorage.getItem('po-puti-device-v3');if(!id){id='device_'+(globalThis.crypto?.randomUUID?.()||ids());safeStorage.setItem('po-puti-device-v3',id)}return id}
function nativePlatform(){return window.Capacitor?.getPlatform?.()==='android'}
function getNativePush(){if(!nativePush&&nativePlatform())nativePush=window.Capacitor.registerPlugin?.('PushNotifications')||window.Capacitor.Plugins?.PushNotifications;return nativePush}
function getRuStorePush(){if(!nativePlatform()||!window.Capacitor?.isPluginAvailable?.('PoPutiRuStorePush'))return null;return window.Capacitor.registerPlugin?.('PoPutiRuStorePush')||window.Capacitor.Plugins?.PoPutiRuStorePush;}
let rustorePushBound=false,pendingRuStoreRecipient=null;
function consumePendingPushPath(){const path=pendingRuStoreRecipient&&pendingRuStoreRecipient!==db.currentUserId?null:pendingPushPath;pendingPushPath=null;pendingRuStoreRecipient=null;return path;}
async function bindRuStorePush(){const plugin=getRuStorePush();if(!plugin||rustorePushBound)return;await plugin.addListener('notificationAction',event=>{if(db.currentUserId&&event.recipientId!==db.currentUserId)return;pendingPushPath=safePushPath(event.path);pendingRuStoreRecipient=event.recipientId;if(accessToken&&db.currentUserId)navigate(consumePendingPushPath())});rustorePushBound=true;}
function syncUnreadBadge(){const count=db.unreadCount??unread();if(navigator.setAppBadge){Promise.resolve(count?navigator.setAppBadge(count):navigator.clearAppBadge?.()).catch(()=>{})}if(!count&&nativePlatform()){getNativePush()?.removeAllDeliveredNotifications?.().catch(()=>{});getRuStorePush()?.clearDelivered?.().catch(()=>{})}}
function pushWidget(){const permission=typeof Notification!=='undefined'?Notification.permission:'default';return `<h3>Уведомления</h3><p class="subtle">${safe(pushMessage||'Фоновые уведомления можно включить для этого устройства.')}</p>${!nativePlatform()?'<p class="tiny muted">На iPhone Web Push доступен в установленной на экран «Домой» PWA при поддержке iOS. Точка на значке Android зависит от системы и лаунчера.</p>':''}<button class="btn btn-primary" data-v3-action="push-enable" ${!pushConfig?'disabled':''}>${permission==='denied'?'Разрешите уведомления в настройках устройства':'Включить уведомления'}</button><button class="btn btn-ghost" data-v3-action="push-disable">Отключить на этом устройстве</button>`}
function refreshPushWidget(){const el=$('#push-controls');if(el)el.innerHTML=pushWidget()}
async function loadPushConfig(){if(pushLoading||pushConfig||!accessToken)return;pushLoading=true;const token=accessToken;try{const result=await api('/push/config');if(token===accessToken)pushConfig=result}catch{if(token===accessToken)pushMessage='Настройки уведомлений сейчас недоступны.'}finally{pushLoading=false;if(token===accessToken)refreshPushWidget()}}
function pushPanel(){if(!remoteMode)return '';const pending=(db.participations||[]).reduce((n,p)=>n+(p.reviewTargets||[]).filter(t=>t.state==='pending_by_user').length,0);Promise.resolve().then(loadPushConfig);return `<section class="section-card" id="push-controls">${pushWidget()}</section><section class="section-card actions">${pending?`<p class="note">Неотправленных отзывов: ${pending}. Форму можно открыть в «Мои отзывы».</p>`:''}<button class="btn btn-ghost" data-action="nav" data-route="/my-reviews">Мои отзывы</button><button class="btn btn-ghost" data-action="nav" data-route="/complaints">Мои обращения</button></section>`}
function safePushPath(value){return typeof value==='string'&&/^\/(?:chat\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+|ride\/[a-zA-Z0-9_-]+|reviews\/[a-zA-Z0-9_-]+|notifications|complaints|admin)$/.test(value)?value:'/notifications'}
async function bindNativePush(){if(nativePushBound||!nativePlatform())return;const plugin=getNativePush();if(!plugin)return;await plugin.addListener('pushNotificationActionPerformed',e=>{pendingPushPath=safePushPath(e.notification?.data?.path);if(accessToken)navigate(pendingPushPath)});await plugin.addListener('pushNotificationReceived',()=>{if(accessToken)refreshRemote({fresh:true})});nativePushBound=true;}
async function enablePush(){
 const token=accessToken;if(!token)return;const config=pushConfig;if(!config)throw Error('Настройки ещё загружаются');
 if(nativePlatform()){
  const rustore=getRuStorePush(),rustoreStatus=rustore?await rustore.status():null;if(config.rustore&&rustoreStatus?.configured){
   if(config.rustoreProjectId&&rustoreStatus.projectId&&config.rustoreProjectId!==rustoreStatus.projectId)throw Error('Настройки уведомлений этой сборки не совпадают с сервером.');
   await bindRuStorePush();const registration=await rustore.register();if(token!==accessToken){await rustore.disable();return;}
   await api('/push/subscribe','POST',{deviceId:pushDeviceId(),platform:'android',provider:'rustore',token:registration.token});
   if(token!==accessToken){await rustore.disable();return;}
   await rustore.activate({userId:db.currentUserId,deviceId:pushDeviceId(),sessionToken:token});pushMessage='Уведомления RuStore включены для этого устройства.';refreshPushWidget();return;
  }
  if(!config.android)throw Error('Фоновые уведомления Android ещё не настроены на сервере или в этой сборке');
  const plugin=getNativePush();if(!plugin)throw Error('Пересоберите Android-приложение с push-плагином');
  await plugin.createChannel?.({id:'trip_updates',name:'Поездки и отзывы',importance:4,visibility:0});
  const permission=await plugin.requestPermissions();if(permission.receive!=='granted')throw Error('Уведомления не разрешены. Центр уведомлений продолжит работать.');
  await bindNativePush();
  const registration=await new Promise(async(resolve,reject)=>{let success,error;const timer=setTimeout(()=>{success?.remove();error?.remove();reject(Error('FCM не ответил. Проверьте Firebase-конфигурацию APK.'))},15000);try{success=await plugin.addListener('registration',v=>{clearTimeout(timer);success?.remove();error?.remove();resolve(v.value)});error=await plugin.addListener('registrationError',()=>{clearTimeout(timer);success?.remove();error?.remove();reject(Error('Не удалось зарегистрировать устройство FCM'))});await plugin.register()}catch(e){clearTimeout(timer);reject(e)}});
  if(token!==accessToken)return;await api('/push/subscribe','POST',{deviceId:pushDeviceId(),platform:'android',token:registration});
 }else{
  if(!config.web)throw Error('Web Push ещё не настроен на сервере (VAPID)');
  if(!('Notification' in window)||!('PushManager' in window)||!('serviceWorker' in navigator))throw Error('Браузер не поддерживает push. На iPhone установите PWA на экран «Домой».');
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent);if(ios&&!navigator.standalone&&!window.matchMedia('(display-mode: standalone)').matches)throw Error('Для уведомлений iPhone добавьте приложение на экран «Домой» и откройте оттуда.');
  // Permission is requested first, directly from the click, preserving Safari user activation.
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Уведомления не разрешены. Центр уведомлений доступен внутри приложения.');
  const reg=await navigator.serviceWorker.ready;const raw=atob(config.vapidPublicKey.replace(/-/g,'+').replace(/_/g,'/'));const key=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const subscription=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  if(token!==accessToken){await subscription.unsubscribe();return}await api('/push/subscribe','POST',{deviceId:pushDeviceId(),platform:'web',subscription:subscription.toJSON()});
 }
 pushMessage='Уведомления включены для этого устройства.';refreshPushWidget();
}
async function unsubscribeLocalPush(){try{if(nativePlatform()){await getRuStorePush()?.disable();if(pushConfig?.android)await getNativePush()?.unregister?.();}else if(navigator.serviceWorker){const reg=await navigator.serviceWorker.getRegistration();const sub=await reg?.pushManager.getSubscription();await sub?.unsubscribe()}}catch{}}
async function disablePush(){await api('/push/unsubscribe','POST',{deviceId:pushDeviceId()});await unsubscribeLocalPush();pushMessage='Уведомления отключены на этом устройстве.';refreshPushWidget()}
const ADMIN_SECTIONS={summary:'Сводка',users:'Пользователи',rides:'Поездки',bookings:'Брони',reviews:'Отзывы',complaints:'Жалобы',notifications:'Уведомления',deliveries:'Доставка push',templates:'Шаблоны',audit:'Аудит',system:'Система'};
function adminKey(){return JSON.stringify([accessToken,v3Admin.section,v3Admin.page,v3Admin.q,v3Admin.status,v3Admin.from,v3Admin.to])}
async function loadAdminV3(){if(v3Admin.loading||me()?.role!=='admin')return;const requestState=v3Admin;const key=adminKey();if(v3Admin.key===key)return;v3Admin.loading=true;const token=accessToken;try{
 const params=new URLSearchParams({page:String(v3Admin.page),q:v3Admin.q,status:v3Admin.status,from:v3Admin.from,to:v3Admin.to});
 if(v3Admin.section==='summary'){if(v3Admin.from)params.set('since',String(Date.parse(v3Admin.from+'T00:00:00Z')));if(v3Admin.to)params.set('until',String(Date.parse(v3Admin.to+'T23:59:59Z')))}
 const data=await api('/admin/v3/'+v3Admin.section+'?'+params);if(token!==accessToken||requestState!==v3Admin||adminKey()!==key)return;v3Admin.data=data;v3Admin.key=key;v3Admin.error='';
 }catch(e){if(token!==accessToken||requestState!==v3Admin||adminKey()!==key)return;v3Admin.error=e.message;v3Admin.key=key;v3Admin.data=null}finally{if(token===accessToken&&requestState===v3Admin){v3Admin.loading=false;if(location.hash==='#/admin')render()}}}
function adminOperationButtons(section,item){const id=safe(item.id);const button=(label,op)=>`<button class="btn btn-ghost" data-v3-action="admin-operation" data-entity="${section}" data-id="${id}" data-operation="${op}">${label}</button>`;
 if(section==='users')return `<button class="btn btn-ghost" data-v3-action="admin-user-detail" data-id="${id}">Профиль и история</button>`+(item.role==='admin'?'':button(item.blockedAt?'Разблокировать':'Заблокировать',item.blockedAt?'unblock':'block'));
 if(section==='rides')return `<button class="btn btn-ghost" data-v3-action="admin-ride-detail" data-id="${id}">История поездки</button>`+button(item.moderationBlocked?'Снять блокировку':'Блокировать объявление',item.moderationBlocked?'unblock':'block')+button('Исправить исход','outcome');
 if(section==='reviews')return button(item.moderationStatus==='blocked'?'Восстановить видимость':'Скрыть отзыв',item.moderationStatus==='blocked'?'unblock':'block');
 if(section==='complaints')return button('Рассмотреть','resolve');return '';
}
function adminRecord(value){const labels={id:'ID',userId:'Участник',user_id:'Участник',username:'Логин',name:'Имя',phone:'Телефон',role:'Роль',created:'Создано',created_at:'Дата',blockedAt:'Заблокирован',blockedReason:'Основание блокировки',origin:'Откуда',destination:'Куда',driver_id:'Водитель',date:'Дата поездки',time:'Отправление',seats:'Мест',price:'Цена',car:'Автомобиль',rideId:'Поездка',ride_id:'Поездка',authorId:'Автор',author_id:'Автор',targetUserId:'Получатель',target_user_id:'Получатель',driverId:'Получатель',author:'Автор',score:'Оценка',text:'Текст',body:'Текст',source:'Источник',isAuto:'Системная оценка',isPublished:'Опубликован',moderationStatus:'Модерация',submittedAt:'Отправлен',visibleAfterAt:'Публикация не раньше',publishedAt:'Опубликован',status:'Статус',answer:'Ответ',reason:'Основание',details:'Подробности',decision:'Решение',comment:'Комментарий',outcome:'Исход',phase:'Стадия',eta_source:'Источник ETA',estimated_arrival_at:'Расчётное прибытие UTC',departure_at:'Отправление UTC',estimated_duration_minutes:'Длительность, мин',route_distance_m:'Дорога, м',departure_timezone:'Пояс отправления',destination_timezone:'Пояс прибытия',route_calculated_at:'Маршрут рассчитан',actor_id:'Администратор',entity_type:'Тип записи',entity_id:'Запись',action:'Действие',old_value:'До изменения',new_value:'После изменения',kind:'Событие',recipientId:'Получатель',readAt:'Прочитано',title:'Заголовок',attempts:'Попыток доставки',last_error:'Последняя ошибка',delivered_at:'Доставлено',next_attempt_at:'Следующая попытка',etaHistory:'История ETA',confirmations:'Ответы участников',bookings:'Бронирования',reviews:'Отзывы',complaints:'Обращения',decisions:'Решения',ride:'Поездка',user:'Профиль',rides:'Поездки',audit:'Журнал действий'};if(value===null||value===undefined)return '—';if(Array.isArray(value))return value.length?value.map(adminRecord).join('<hr>'):'Нет записей';if(typeof value==='boolean')return value?'Да':'Нет';if(typeof value!=='object')return safe(value);return `<dl class="admin-record">${Object.entries(value).map(([key,v])=>`<dt>${safe(labels[key]||key)}</dt><dd>${adminRecord(typeof v==='number'&&/(?:At|_at)$/.test(key)?new Date(v).toISOString():v)}</dd>`).join('')}</dl>`}
function v3AdminPage(){
 Promise.resolve().then(loadAdminV3);const section=v3Admin.section,data=v3Admin.data;
 const filters=`<form id="v3-admin-filters" class="stack"><label class="field">Поиск по ID, имени, телефону или маршруту<input name="q" maxlength="100" value="${safe(v3Admin.q)}"></label><label class="field">Статус<input name="status" value="${safe(v3Admin.status)}" placeholder="Например: disputed, blocked, pending"></label><div class="two-col"><label class="field">С даты (UTC)<input type="date" name="from" value="${safe(v3Admin.from)}"></label><label class="field">По дату (UTC)<input type="date" name="to" value="${safe(v3Admin.to)}"></label></div><button class="btn btn-primary" type="submit">Применить</button></form>`;
 let content='';if(data){if(data.items){content=data.items.map(item=>`<section class="section-card"><div class="admin-json">${adminRecord(item)}</div><div class="actions">${adminOperationButtons(section,item)}</div>${section==='templates'?`<button class="btn btn-ghost" data-v3-action="admin-template" data-kind="${safe(item.kind)}">Изменить шаблон</button>`:''}</section>`).join('')||empty('Нет записей','Попробуйте изменить фильтры.');content+=`<div class="actions"><button class="btn btn-ghost" data-v3-action="admin-prev" ${data.page<=1?'disabled':''}>Назад</button><span>Страница ${data.page}; всего ${data.total}</span><button class="btn btn-ghost" data-v3-action="admin-next" ${data.page*data.size>=data.total?'disabled':''}>Далее</button></div>`}else content=`<section class="section-card"><dl class="admin-summary">${Object.entries(data).map(([k,v])=>`<dt>${safe(({users:'Пользователей',scheduled:'Запланировано',inProgress:'В пути',past:'Прошедших',cancelled:'Отменено',confirmedBookings:'Подтверждённых броней',openComplaints:'Открытых жалоб',disputed:'Спорных поездок',pendingReviews:'Скрытых отзывов',publishedReviews:'Опубликованных отзывов',pushErrors:'Ошибок push',serverNow:'Время сервера (UTC)',workers:'Планировщики',push:'Настройка push',queues:'Очереди',duplicateReviews:'Дубли отзывов',version:'Версия',serviceWorker:'Service Worker'})[k]||k)}</dt><dd>${typeof v==='object'?`<pre class="admin-json">${safe(JSON.stringify(v,null,2))}</pre>`:safe(k==='serverNow'?new Date(v).toISOString():v)}</dd>`).join('')}</dl></section>`}
 return `<main class="page admin-page"><h1>Кабинет администратора</h1><div class="actions">${Object.entries(ADMIN_SECTIONS).map(([key,label])=>`<button class="btn btn-${key===section?'primary':'ghost'}" data-v3-action="admin-section" data-section="${key}">${label}</button>`).join('')}</div><section class="section-card">${filters}</section>${v3Admin.error?`<p class="warning">${safe(v3Admin.error)}</p>`:''}${v3Admin.loading?'<p role="status">Загрузка…</p>':''}${content}${section==='notifications'?'<button class="btn btn-primary" data-v3-action="admin-push-test">Отправить тест только себе</button>':''}${section==='templates'?'<button class="btn btn-ghost" data-v3-action="admin-template">Добавить системный шаблон</button>':''}</main>`;
}
document.addEventListener('click',async ev=>{const el=ev.target.closest('[data-v3-action]');if(!el)return;ev.preventDefault();const action=el.dataset.v3Action,id=el.dataset.id;
 try{
  if(action==='yes'){const result=await api('/confirmations','POST',{rideId:id,answer:'yes'});await refreshRemote({fresh:true});if(result.openReview)openV3Review(id);return}
  if(action==='no'){showModal('Поездка не состоялась',`<form id="v3-no-form" class="stack"><input type="hidden" name="rideId" value="${safe(id)}"><label class="field">Причина<textarea name="reason" required maxlength="500"></textarea></label><button class="btn btn-primary" type="submit">Подтвердить ответ «Нет»</button></form>`,btn('Назад','modal-close','ghost'));return}
  if(action==='review'){openV3Review(id,el.dataset.target);return}
  if(action==='complaint'){showModal('Обращение по поездке',`<form id="v3-complaint-form" class="stack"><input type="hidden" name="rideId" value="${safe(id)}"><label class="field">Причина<input name="reason" required maxlength="100" value="Неверный факт поездки"></label><label class="field">Подробности<textarea name="details" maxlength="500"></textarea></label><button class="btn btn-primary" type="submit">Отправить обращение</button></form>`,btn('Закрыть','modal-close','ghost'));return}
  if(action==='push-enable'){await enablePush();return}if(action==='push-disable'){await disablePush();return}
  if(action==='read-all'){await api('/notifications/read-all','POST',{});await refreshRemote({fresh:true});return}
  if(action==='request-cancel'){await mutateRemote('/requests/'+encodeURIComponent(id)+'/cancel',{},'Заявка отменена');return}
  if(action==='admin-section'){v3Admin={...v3Admin,section:el.dataset.section,page:1,data:null,key:'',loading:false};render();return}
  if(action==='admin-prev'||action==='admin-next'){v3Admin.page=Math.max(1,v3Admin.page+(action==='admin-prev'?-1:1));v3Admin.data=null;render();return}
  if(action==='admin-ride-detail'){const data=await api('/admin/v3/rides/'+encodeURIComponent(id));showModal('Поездка, участники и обращения',`<div class="admin-json">${adminRecord(data)}</div>`,btn('Закрыть','modal-close','ghost'));return}
  if(action==='admin-user-detail'){const data=await api('/admin/v3/users/'+encodeURIComponent(id));showModal('Профиль и история',`<div class="admin-json">${adminRecord(data)}</div>`,btn('Закрыть','modal-close','ghost'));return}
  if(action==='admin-operation'){
   const op=el.dataset.operation,entity=el.dataset.entity;
   showModal('Решение модератора',`<form id="v3-admin-operation" class="stack"><input type="hidden" name="entity" value="${safe(entity)}"><input type="hidden" name="entityId" value="${safe(id)}"><input type="hidden" name="operation" value="${safe(op)}">${['outcome','resolve'].includes(op)?`<label class="field">Решение<select name="decision">${['completed','not_held','unverified',...(op==='outcome'?['disputed']:['closed'])].map(x=>`<option value="${x}">${safe(OUTCOME_LABELS[x]||'Закрыть обращение')}</option>`).join('')}</select></label>`:''}<label class="field">Обязательное основание<textarea name="reason" required maxlength="1000"></textarea></label><p class="warning">Действие будет записано в неизменяемый журнал аудита. Текст и звёзды отзывов не меняются.</p><button class="btn btn-primary" type="submit">Подтвердить решение</button></form>`,btn('Отмена','modal-close','ghost'));return;
  }
  if(action==='admin-push-test'){showModal('Тест уведомления',`<form id="v3-push-test"><label class="field">Основание<input name="reason" required maxlength="1000" value="Проверка доставки самому администратору"></label><button class="btn btn-primary" type="submit">Отправить только мне</button></form>`,btn('Отмена','modal-close','ghost'));return}
  if(action==='admin-template'){const template=v3Admin.data?.items?.find(t=>t.kind===el.dataset.kind);showModal('Системный шаблон',`<form id="v3-template-form" class="stack"><label class="field">Событие<select name="kind">${['ride_confirmation','review_reminder','review_published','complaint_result','moderation_result'].map(k=>`<option ${template?.kind===k?'selected':''}>${k}</option>`).join('')}</select></label><label class="field">Заголовок<input name="title" required maxlength="80" value="${safe(template?.title||'')}"></label><label class="field">Текст<textarea name="body" maxlength="250">${safe(template?.body||'')}</textarea></label><label class="field">Основание<input name="reason" required maxlength="1000"></label><button class="btn btn-primary" type="submit">Сохранить с аудитом</button></form>`,btn('Отмена','modal-close','ghost'));return}
 }catch(e){toast(e.message)}
});
document.addEventListener('submit',async ev=>{
 const form=ev.target;if(!form.id?.startsWith('v3-'))return;ev.preventDefault();const fd=new FormData(form),data=Object.fromEntries(fd);const token=accessToken;const submit=form.querySelector('[type="submit"]');if(submit?.disabled)return;if(submit)submit.disabled=true;
 try{
  if(form.id==='v3-admin-filters'){v3Admin={...v3Admin,...data,page:1,data:null,key:'',loading:false};render();return}
  let path;
  if(form.id==='v3-review-form')path='/reviews';
  else if(form.id==='v3-no-form'){path='/confirmations';data.answer='no'}
  else if(form.id==='v3-complaint-form'){path='/complaints';data.category='ride_fact'}
  else if(form.id==='v3-admin-operation'){path='/admin/v3/'+data.entity+'/'+encodeURIComponent(data.entityId)+'/'+data.operation;data.outcome=data.decision}
  else if(form.id==='v3-template-form')path='/admin/v3/templates';
  else if(form.id==='v3-push-test')path='/admin/v3/push-test';
  if(!path)return;const result=await api(path,'POST',data);if(token!==accessToken)return;hideModal();v3Admin.key='';v3Admin.data=null;await refreshRemote({fresh:true});toast(result.message||'Сохранено');
 }catch(e){if(token===accessToken)toast(e.message)}finally{if(submit)submit.disabled=false}
});

bindNativePush().catch(()=>{});
bindRuStorePush().catch(()=>{});
window.addEventListener('hashchange',()=>{render();scrollTo({top:0})});
window.addEventListener('online',()=>{render();toast('Соединение восстановлено');if(remoteMode&&accessToken)refreshRemote({fresh:true})});
window.addEventListener('offline',()=>render());
setInterval(()=>{if(remoteMode&&accessToken&&navigator.onLine&&document.visibilityState==='visible'&&!imageProcessing&&!publishing&&!document.querySelector('.overlay')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))refreshRemote()},45000);
window.addEventListener('focus',()=>{if(remoteMode&&accessToken&&navigator.onLine&&!imageProcessing&&!publishing&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&Date.now()-lastStateSuccessAt>15000)refreshRemote()});
window.addEventListener('storage',event=>{if(cookieSession&&event.key===COOKIE_STORE){if(event.newValue===accessToken)return;clearRemoteSession(true);if(event.newValue){accessToken=event.newValue;safeStorage.setItem(COOKIE_STORE,accessToken);refreshRemote()}else navigate('/login');return;}if(!remoteMode&&event.key===STORE){try{db=JSON.parse(event.newValue)||seed();render()}catch{}}});
if(!location.hash){const path=location.pathname||'';location.hash=/^\/(?:login|search|publish|trips|notifications|profile|my-reviews|complaints|admin|ride\/[^/]+|reviews\/[^/]+|chat\/[^/]+\/[^/]+)\/?$/.test(path)?path.replace(/\/$/,''):'/search';}if(remoteMode){let localUI={};try{localUI=JSON.parse(safeStorage.getItem('po-puti-ui-v2')||'{}')}catch{localUI={}};if(!localUI||typeof localUI!=='object'||Array.isArray(localUI))localUI={};if(localUI.search&&(!['from','to','date'].every(key=>typeof localUI.search[key]==='string')))localUI.search=null;if(localUI.draft&&(typeof localUI.draft!=='object'||Array.isArray(localUI.draft)||['from','to','date','time','car'].some(key=>typeof localUI.draft[key]!=='string')))localUI.draft=null;db={currentUserId:null,users:[],rides:[],requests:[],notifications:[],reviews:[],messages:[],reports:[],search:localUI.search||{from:'Москва',to:'Санкт-Петербург',date:today(1)},searchSubmitted:true,draft:localUI.draft||null};if(accessToken){render();if(cookieSession&&!isCookieToken(accessToken)){const legacyToken=accessToken;api('/session','POST',{}).then(()=>{if(accessToken!==legacyToken)return;accessToken='cookie:'+ids();safeStorage.removeItem(TOKEN_STORE);safeStorage.setItem(COOKIE_STORE,accessToken);return refreshRemote()}).catch(err=>{if(accessToken!==legacyToken)return;if(err.status===401)expireRemoteSession();serverError=err.message;render()})}else refreshRemote()}else{navigate('/login');render()}}else{save();render()};
if(typeof nativeBridge==='function'&&nativeBridge())restoreNativeSession();
// Service Worker update is managed by index.html only; never delay app rendering.

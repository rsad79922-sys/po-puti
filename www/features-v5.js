/* Shared feature controllers. No provider keys, private tokens or business rules live here. */
const preservedAdNodes=new Map();
function preserveAds(){for(const node of document.querySelectorAll('[data-ad-slot]'))if(node.querySelector('iframe')||mountedAds.has(node.dataset.adSlot))preservedAdNodes.set(node.dataset.adSlot,node)}
function restoreAds(){if(!featureState.consent){for(const node of preservedAdNodes.values())node.remove();preservedAdNodes.clear();return}for(const [name,node] of preservedAdNodes){const target=document.querySelector('[data-ad-slot="'+name+'"]');if(target&&node!==target)target.replaceWith(node)}}
let nativeFeatures=null,nativeFeatureBound=false,nativeSearchVisible=false,nativeSearchFailed=false,webAdObserver=null;
const mountedAds=new Set();
function nativeBridge(){
 if(!window.Capacitor?.isPluginAvailable?.('PoPutiFeatures'))return null;
 return nativeFeatures||(nativeFeatures=Capacitor.registerPlugin?.('PoPutiFeatures')||Capacitor.Plugins?.PoPutiFeatures);
}
function consentStorageKey(){return 'ad-consent:'+db.currentUserId+':'+(featureState.config?.privacy.policyVersion||'2026-11-v5')}
function persistNativeSession(token){const bridge=nativeBridge();if(bridge){safeStorage.removeItem(TOKEN_STORE);bridge.setToken({token}).catch(()=>toast('Не удалось сохранить вход на устройстве'))}else safeStorage.setItem(TOKEN_STORE,token)}
async function restoreNativeSession(){const bridge=nativeBridge();if(!bridge||cookieSession)return;try{const value=await bridge.getToken();if(value.token)accessToken=value.token;else if(accessToken)await bridge.setToken({token:accessToken});safeStorage.removeItem(TOKEN_STORE);if(accessToken){const fresh=await refreshRemote();if(fresh&&accessToken&&location.hash==='#/login'){navigate(pendingPushPath||'/search');pendingPushPath=null;}}}catch{safeStorage.removeItem(TOKEN_STORE);toast('Защищённое хранилище недоступно. Войдите снова')}}
function seriesFormMarkup(d){const end=d.seriesEnd||new Date(Date.parse(d.date||today())+6*86400000).toISOString().slice(0,10);return `<section class="section-card"><h3>Как часто едете?</h3><label class="field"><select name="seriesMode"><option value="once">Разовая поездка</option><option value="regular" ${d.series?'selected':''}>Регулярная — до 7 дней</option></select></label>${d.series?`<div class="field"><label>Последняя дата<input name="seriesEnd" type="date" required min="${safe(d.date)}" max="${safe(new Date(Date.parse(d.date)+6*86400000).toISOString().slice(0,10))}" value="${safe(end)}"></label></div><fieldset class="weekdays"><legend>Дни отправления</legend>${['Вс','Пн','Вт','Ср','Чт','Пт','Сб'].map((name,n)=>`<label><input type="checkbox" name="weekdays" value="${n}" ${(d.weekdays||[0,1,2,3,4,5,6]).includes(n)?'checked':''}>${name}</label>`).join('')}</fieldset><label class="field">Исключить даты (ГГГГ-ММ-ДД, через запятую)<input name="exceptions" value="${safe((d.exceptions||[]).join(', '))}" maxlength="100"></label><label class="checkbox-line"><input type="checkbox" name="privateRide" required ${d.privateRide?'checked':''}>Это частные поездки, не профессиональная автобусная перевозка</label><p class="subtle">Для каждой даты — своя поездка и свои пассажиры. Продление только по вашему подтверждению.</p>`:''}</section>`}
function busTime(at,zone){try{return new Intl.DateTimeFormat('ru-RU',{timeZone:zone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at))}catch{return 'Время не указано'}}
function busCard(item){const p=item.purchase||{};return `<article class="section-card bus-card" data-result-type="bus"><span class="chip">Автобус</span><h3>${safe(busTime(item.departureAt,item.departureTimeZone))} → ${safe(busTime(item.arrivalAt,item.destinationTimeZone))}</h3><p>${safe(item.from)} → ${safe(item.to)}</p>${item.carrier?`<p>Перевозчик: ${safe(item.carrier)}</p>`:''}<strong>Где купить билет</strong><p>${p.url?`<a href="${safe(p.url)}" target="_blank" rel="noopener noreferrer" data-ticket-url="${safe(p.url)}">Перейти к покупке этого рейса</a>`:p.cashier?safe(p.cashier):'Информация о покупке билета отсутствует'}</p><p class="rasp-credit"><a href="https://rasp.yandex.ru/" target="_blank" rel="noopener noreferrer">Данные предоставлены сервисом Яндекс.Расписания</a></p><p class="subtle">Справочное расписание. Уточните отправление у перевозчика. Время местное для каждой остановки.</p></article>`}
function raspCopyright(){const credit=featureState.bus.copyright;return credit?`<div class="rasp-copyright"><iframe title="Яндекс Расписания — источник данных" src="${safe(credit.frameUrl)}" width="240" height="130" loading="lazy" sandbox="allow-scripts allow-popups" referrerpolicy="no-referrer"></iframe><p><a href="https://rasp.yandex.ru/" target="_blank" rel="noopener">${safe(credit.text)}</a></p></div>`:''}
function adSlot(name){return `<aside class="ad-slot" data-ad-slot="${name}" aria-label="Реклама" hidden><span>Реклама</span><div id="ad-${name}"></div></aside>`}
function placeChoices(side){const choices=featureState.choices[side]||[];return choices.length?`<label class="field">Уточните ${side==='from'?'отправление':'назначение'}<select data-place-choice="${side}"><option value="">Выберите город или станцию</option>${choices.map(p=>`<option value="${safe(p.code)}">${safe(p.title)} · ${safe(p.region)}${p.kind==='station'?' · остановка':''}</option>`).join('')}</select></label>`:''}
function busStatus(){const status=featureState.bus.status;if(status==='idle'||status==='not_requested')return '';const labels={loading:'Ищем автобусные рейсы…',empty:'Автобусные рейсы на выбранную дату не найдены.',not_configured:'Автобусные расписания пока не подключены.',unavailable:'Сервис автобусных расписаний временно недоступен. Частные поездки доступны.',quota_exceeded:'Лимит сервиса расписаний исчерпан. Попробуйте позже.',choose_places:'Уточните населённые пункты или станции ниже.',invalid_query:'Укажите оба пункта и корректную дату поиска.'};return labels[status]?`<p class="note" role="status">${safe(labels[status])}</p>`:''}
function unifiedResults(){
 const query=db.search||{};const local=db.rides.filter(r=>!r.cancelled&&r.canChangeParticipants!==false&&!r.moderationBlocked&&(!query.from||r.from.toLowerCase()===query.from.toLowerCase())&&(!query.to||r.to.toLowerCase()===query.to.toLowerCase())&&(!query.date||r.date===query.date)&&seatsLeft(r)>0);
 const priv=featureState.private||local;return [...(featureState.filter==='bus'?[]:priv.map(r=>({...r,type:'private_ride'}))),...(featureState.filter==='private'||featureState.bus.expiresAt&&Date.now()>=featureState.bus.expiresAt?[]:featureState.bus.items)].sort((a,b)=>String(a.departureAt||a.date+'T'+a.time).localeCompare(String(b.departureAt||b.date+'T'+b.time))||a.id.localeCompare(b.id));
}
function unifiedSearchPage(){const items=unifiedResults();const ads=featureState.config?.ads.enabled;return `<main class="page"><div class="page-head"><h1>Куда едем?</h1><p>Попутчики и междугородние автобусы</p></div>${searchPanel()}${adSlot('search')}<div class="segmented" aria-label="Тип поездки">${[['all','Все'],['private','Попутчики'],['bus','Автобусы']].map(([v,label])=>`<button data-search-filter="${v}" class="${featureState.filter===v?'active':''}">${label}</button>`).join('')}</div>${featureState.filter!=='private'?busStatus()+placeChoices('from')+placeChoices('to'):''}<div class="trip-list">${items.length?items.map((r,i)=>(r.type==='bus_service'?busCard(r):rideCard(r))+(i===4?adSlot('results'):'')).join(''):empty('Подходящих поездок пока нет','Измените маршрут или дату. Отсутствие автобусного ответа не означает отсутствие рейсов.')}${items.length<5?adSlot('results'):''}</div>${featureState.filter!=='private'?raspCopyright():''}${featureState.privateCursor&&featureState.filter!=='bus'?'<button class="btn btn-ghost" data-more-private>Ещё частные поездки</button>':''}${featureState.bus.nextOffset!=null?'<button class="btn btn-ghost" data-more-buses>Ещё автобусные рейсы</button>':''}${ads?`<section class="privacy-ads"><p>Реклама Яндекса загружается с вашего согласия.</p><button class="small-link" data-ad-consent="${featureState.consent?'false':'true'}">${featureState.consent?'Отключить рекламу':'Разрешить рекламу'}</button></section>`:''}<button class="btn btn-primary full" data-action="nav" data-route="/publish">Предложить поездку</button><a class="small-link" href="${safe(SERVER_BASE)}/privacy.html" target="_blank" rel="noopener">Конфиденциальность и источники данных</a></main>`}
async function runUnifiedSearch(more=false,resolving=false){
 if(!remoteMode||!accessToken)return;const q=db.search||{};if(!q.from||!q.to||!/^\d{4}-\d{2}-\d{2}$/.test(q.date)||!Number.isFinite(Date.parse(q.date))||new Date(q.date).toISOString().slice(0,10)!==q.date){featureState.epoch++;featureState.queryKey=JSON.stringify(q);featureState.private=[];featureState.privateCursor=null;featureState.bus={items:[],status:'invalid_query'};if(location.hash==='#/search')render();return;}
 const epoch=more?featureState.epoch:++featureState.epoch,token=accessToken,key=JSON.stringify(q);featureState.queryKey=key;
 if(!more){featureState.private=null;featureState.privateCursor=null;featureState.bus={items:[],status:'loading'};featureState.choices={};}
 const args=new URLSearchParams({from:q.fromCode||q.from,to:q.toCode||q.to,date:q.date});
 if(more)args.set('offset',String(featureState.bus.nextOffset||0));
 const live=()=>epoch===featureState.epoch&&token===accessToken;
 const rerender=()=>{if(location.hash==='#/search')render()};
 if(!more)api('/search?'+new URLSearchParams({from:q.from,to:q.to,date:q.date,type:'private'})).then(data=>{if(!live())return;featureState.private=data.private.items;featureState.privateCursor=data.private.nextCursor;rerender()}).catch(()=>{});
 try{
  const data=await api('/search?'+args+'&type=bus');if(!live())return;
  const previous=more?featureState.bus.items:[];featureState.bus={...data.bus,items:[...new Map([...previous,...data.bus.items].map(r=>[r.id,r])).values()]};clearTimeout(featureState.busTimer);if(data.bus.expiresAt)featureState.busTimer=setTimeout(()=>{if(!live())return;featureState.bus.items=[];featureState.queryKey='';if(document.visibilityState==='visible'&&location.hash==='#/search'){if(navigator.onLine)runUnifiedSearch();render();}},Math.max(0,data.bus.expiresAt-Date.now()));
  if(data.bus.status==='choose_places'){
   const resolved={...q};let unambiguous=true;
   for(const side of ['from','to']){const choices=await api('/search/places?q='+encodeURIComponent(q[side]));if(!live())return;featureState.choices[side]=choices.items||[];const exact=(choices.items||[]).filter(p=>p.kind==='settlement'&&p.title.toLocaleLowerCase('ru')===q[side].toLocaleLowerCase('ru'));const selected=q[side+'Code'];if(selected&&(choices.items||[]).some(p=>p.code===selected))resolved[side+'Code']=selected;else if(exact.length===1&&(!selected||selected.startsWith('c')))resolved[side+'Code']=exact[0].code;else unambiguous=false;if(!choices.items?.length&&choices.status==='unavailable')featureState.bus.status='unavailable';}
   if(unambiguous&&!resolving){db.search=resolved;save();await runUnifiedSearch(false,true);return;}
  }
 }catch{if(live())featureState.bus={items:[],status:'unavailable'}}finally{if(live())rerender()}
}
async function syncFeatures(){
 if(!remoteMode||!accessToken){if(nativeSearchVisible){nativeSearchVisible=false;nativeBridge()?.closeSearch().catch(()=>{})}return;}
 if(!featureState.config&&!featureState.loading){featureState.loading=true;const token=accessToken;try{const config=await api('/client-config');if(token!==accessToken)return;featureState.config=config;featureState.consent=safeStorage.getItem(consentStorageKey())==='true';}catch{}finally{featureState.loading=false}}
 if(location.hash==='#/trips'&&!featureState.series&&!featureState.seriesLoading){featureState.seriesLoading=true;const token=accessToken;try{const result=await api('/series');if(token===accessToken){featureState.series=result.items;if(location.hash==='#/trips')render()}}catch{}finally{featureState.seriesLoading=false}}
 if(location.hash==='#/search'){
  if(featureState.bus.expiresAt&&featureState.bus.expiresAt<=Date.now())featureState.queryKey='';
  const key=JSON.stringify(db.search||{});if(featureState.queryKey!==key)runUnifiedSearch();
  if(nativeBridge()&&!nativeSearchFailed){try{await syncNativeSearch()}catch{nativeSearchFailed=true;nativeSearchVisible=false;nativeBridge()?.closeSearch().catch(()=>{})}}else mountWebAds();
 }else if(nativeSearchVisible){nativeSearchVisible=false;nativeBridge()?.closeSearch().catch(()=>{})}
}
function mountWebAds(){
 const config=featureState.config?.ads;if(!config?.enabled||!featureState.consent||config.test||window.Capacitor)return;
 if(!window.yaContextCb)window.yaContextCb=[];
 if(!document.querySelector('[data-yandex-web-loader]')){const script=document.createElement('script');script.src='https://yandex.ru/ads/system/context.js';script.async=true;script.dataset.yandexWebLoader='true';script.referrerPolicy='no-referrer';document.head.appendChild(script)}
 webAdObserver?.disconnect();webAdObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const slot=entry.target,name=slot.dataset.adSlot,id=config.web.find(s=>s.name===name)?.id;if(!id||mountedAds.has(name))continue;mountedAds.add(name);slot.hidden=false;window.yaContextCb.push(()=>{if(!featureState.consent||!document.contains(slot))return;try{window.Ya.Context.AdvManager.render({blockId:id,renderTo:'ad-'+name,onError:()=>{slot.hidden=true},onNoAds:()=>{slot.hidden=true}})}catch{slot.hidden=true}});webAdObserver.unobserve(slot)}});
 for(const slot of document.querySelectorAll('[data-ad-slot]')){if(mountedAds.has(slot.dataset.adSlot))continue;const id=config.web.find(s=>s.name===slot.dataset.adSlot)?.id;if(id){slot.hidden=false;webAdObserver.observe(slot);setTimeout(()=>{if(!slot.querySelector('iframe'))slot.hidden=true},8000)}}
}
async function syncNativeSearch(){
 const bridge=nativeBridge(),session=accessToken;if(!nativeFeatureBound){nativeFeatureBound=true;
  await bridge.addListener('search',data=>{db.search={from:data.from,to:data.to,date:data.date};featureState.filter=data.filter||'all';featureState.queryKey='';save();runUnifiedSearch()});
  await bridge.addListener('nativeSearchError',()=>{nativeSearchFailed=true;nativeSearchVisible=false;bridge.closeSearch().catch(()=>{})});
  await bridge.addListener('filter',data=>{featureState.filter=data.filter;render()});
  await bridge.addListener('place',data=>{if(['from','to'].includes(data.side)){db.search[data.side+'Code']=data.code;save();runUnifiedSearch()}});
  await bridge.addListener('navigate',data=>{nativeSearchVisible=false;if(['trips','notifications','profile'].includes(data.route))navigate('/'+data.route)});
  await bridge.addListener('refreshSearch',()=>{featureState.queryKey='';runUnifiedSearch()});
  await bridge.addListener('morePrivate',loadMorePrivate);
  await bridge.addListener('more',()=>runUnifiedSearch(true));
  await bridge.addListener('adConsent',data=>{featureState.consent=data.granted===true;safeStorage.setItem(consentStorageKey(),String(featureState.consent));api('/privacy/consent','POST',{category:'advertising',granted:featureState.consent}).catch(()=>{});render()});
  await bridge.addListener('openRide',data=>{nativeSearchVisible=false;navigate('/ride/'+encodeURIComponent(data.id))});
  await bridge.addListener('publish',()=>{nativeSearchVisible=false;navigate('/publish')});
  await bridge.addListener('closeSearch',()=>{nativeSearchVisible=false;navigate('/trips')});
 }
 if(!session||session!==accessToken||location.hash!=='#/search')return;
 const items=unifiedResults().map(r=>r.type==='bus_service'?r:{type:'private_ride',id:r.id,from:r.from,to:r.to,date:r.date,time:r.time,price:r.price,available:seatsLeft(r),driver:user(r.driverId).name,car:r.car});
 nativeSearchVisible=true;await bridge.showSearch({query:db.search,filter:featureState.filter,items,choices:featureState.choices,hasMore:featureState.bus.nextOffset!=null,hasMorePrivate:!!featureState.privateCursor,expiresAt:featureState.bus.expiresAt||0,status:busStatus().replace(/<[^>]*>/g,''),ads:featureState.config?.ads||{enabled:false},consent:featureState.consent});if(session!==accessToken||location.hash!=='#/search'){nativeSearchVisible=false;await bridge.closeSearch()}
}
function privacyMarkup(){return `<section class="section-card"><h3>Конфиденциальность</h3><a href="${safe(SERVER_BASE)}/privacy.html" target="_blank" rel="noopener">Политика и источники данных</a><p><button class="small-link" data-request-deletion>Запросить удаление аккаунта</button></p>${me()?.role==='admin'?'<button class="small-link" data-mfa-enroll>Настроить MFA администратора</button>':''}</section>`}
document.addEventListener('change',e=>{
 if(e.target.name==='seriesMode'){setDraftFromForm();render()}
 if(e.target.dataset.placeChoice&&e.target.value){const side=e.target.dataset.placeChoice;db.search[side+'Code']=e.target.value;save();runUnifiedSearch()}
});
document.addEventListener('click',async e=>{
 const filter=e.target.closest('[data-search-filter]');if(filter){featureState.filter=filter.dataset.searchFilter;render()}
 if(e.target.closest('[data-more-private]'))loadMorePrivate();
 if(e.target.closest('[data-more-buses]'))runUnifiedSearch(true);
 const consent=e.target.closest('[data-ad-consent]');if(consent){featureState.consent=consent.dataset.adConsent==='true';safeStorage.setItem(consentStorageKey(),String(featureState.consent));api('/privacy/consent','POST',{category:'advertising',granted:featureState.consent}).catch(()=>{}).finally(()=>{if(!featureState.consent&&!window.Capacitor)location.reload()});render()}
 const ticket=e.target.closest('[data-ticket-url]');if(ticket&&nativeBridge()){e.preventDefault();nativeBridge().openExternal({url:ticket.dataset.ticketUrl}).catch(()=>toast('Не удалось открыть ссылку'))}
 if(e.target.closest('[data-request-deletion]'))showModal('Запрос удаления аккаунта','Запрос будет зарегистрирован для обработки по политике хранения. До её согласования данные автоматически не удаляются.','<button class="btn btn-danger" data-confirm-deletion>Подтвердить запрос</button>');
 if(e.target.closest('[data-confirm-deletion]')){try{await api('/account/deletion-request','POST',{confirmation:'DELETE_MY_ACCOUNT'});hideModal();toast('Запрос зарегистрирован')}catch(err){toast(err.message)}}
 if(e.target.closest('[data-mfa-enroll]'))showModal('Подтвердите пароль','<form id="mfa-enroll-password"><label>Пароль<input name="password" type="password" required autocomplete="current-password"></label><button class="btn btn-primary" type="submit">Продолжить</button></form>','');
});
document.addEventListener('submit',async e=>{ if(e.target.id==='mfa-enroll-password'){e.preventDefault();try{const setup=await api('/admin/mfa/enroll','POST',{password:new FormData(e.target).get('password')});showModal('MFA администратора',`Добавьте секрет в приложение-аутентификатор: <code>${safe(setup.secret)}</code><form id="mfa-enable"><label>Код<input name="code" inputmode="numeric" pattern="[0-9]{6}" required autocomplete="one-time-code"></label><button class="btn btn-primary" type="submit">Включить</button></form>`,'')}catch(err){toast(err.message)}}if(e.target.id!=='mfa-enable')return;e.preventDefault();try{await api('/admin/mfa/verify','POST',{code:new FormData(e.target).get('code')});hideModal();toast('MFA включена')}catch(err){toast(err.message)}});

function seriesManagementMarkup(){return (featureState.series||[]).map(s=>`<section class="section-card"><h3>Регулярные поездки</h3><p>${safe(s.startDate)} — ${safe(s.endDate)} · ${safe(s.time)}</p><button class="small-link" data-edit-series="${safe(s.id)}">Изменить будущие отправления без заявок</button><p><button class="small-link" data-renew-series="${safe(s.id)}">Создать новую серию</button></p><button class="small-link" data-cancel-series="${safe(s.id)}">Отменить оставшиеся отправления</button></section>`).join('')}
document.addEventListener('click',async e=>{
 const renew=e.target.closest('[data-renew-series]'),edit=e.target.closest('[data-edit-series]'),cancel=e.target.closest('[data-cancel-series]');
 if(renew||edit){const id=(renew||edit).dataset[renew?'renewSeries':'editSeries'],series=featureState.series.find(s=>s.id===id),ride=db.rides.find(r=>r.seriesId===id&&r.canChangeParticipants)||db.rides.find(r=>r.seriesId===id);if(!ride)return toast('Обновите список поездок');
  if(edit){const first=series.rides.find(r=>!r.cancelled&&db.rides.find(x=>x.id===r.id)?.canChangeParticipants);if(!first)return toast('Будущих отправлений нет');beginRouteEdit(first.id);db.draft.editingSeriesId=id;save();render();}
  else{const date=today(1);db.draft={...ride,from:ride.from,to:ride.to,date,series:true,seriesEnd:new Date(Date.parse(date)+6*86400000).toISOString().slice(0,10),weekdays:series.weekdays,exceptions:[],privateRide:false,editingRideId:null,clientKey:ids(),routeQuoteId:null,routeResult:null,routePoints:null,seriesId:null};pubStep=1;save();navigate('/publish')}
 }
 if(cancel)showModal('Отменить будущие поездки?','Заявки на будущие отправления будут отменены, пассажиры получат уведомления. Прошедшие поездки сохранятся.',`<button class="btn btn-danger" data-confirm-series-cancel="${safe(cancel.dataset.cancelSeries)}">Отменить отправления</button>`);
 const confirmed=e.target.closest('[data-confirm-series-cancel]');if(confirmed){try{await api('/series/'+encodeURIComponent(confirmed.dataset.confirmSeriesCancel)+'/cancel','POST',{});hideModal();featureState.series=null;await refreshRemote({fresh:true});toast('Будущие отправления отменены')}catch(err){toast(err.message)}}
});

async function loadMorePrivate(){
 if(!featureState.privateCursor||featureState.privateLoading)return;featureState.privateLoading=true;const epoch=featureState.epoch,token=accessToken,q=db.search||{};
 try{const args=new URLSearchParams({from:q.from,to:q.to,date:q.date,type:'private',cursor:featureState.privateCursor});const data=await api('/search?'+args);if(epoch!==featureState.epoch||token!==accessToken)return;featureState.private=[...new Map([...(featureState.private||[]),...data.private.items].map(r=>[r.id,r])).values()];featureState.privateCursor=data.private.nextCursor;if(location.hash==='#/search')render();}
 catch{if(epoch===featureState.epoch&&token===accessToken)toast('Не удалось загрузить следующую страницу. Повторите попытку.')}
 finally{featureState.privateLoading=false}
}

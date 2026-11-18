/* Shared feature controllers. No provider keys, private tokens or business rules live here. */
// A public link only: no auto-download, app launch, auth token or trip redirect.
const androidDownloadState={url:'',requested:false,dismissed:false,pending:null};
const androidDownloadDismissKey='po-puti-android-download-dismissed-v1';
function androidBrowserDownloadEligible(){
 const ua=navigator.userAgent||'';
 if(!/Android/i.test(ua)||/iPhone|iPad|iPod|\bwv\b/i.test(ua)||(/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1))return false;
 if(navigator.userAgentData?.platform&&navigator.userAgentData.platform!=='Android')return false;
 if(window.Capacitor||navigator.standalone===true||document.referrer.startsWith('android-app://'))return false;
 return !['standalone','fullscreen','minimal-ui','window-controls-overlay'].some(mode=>window.matchMedia?.('(display-mode: '+mode+')').matches);
}
function paintAndroidDownload(){
 const host=document.querySelector('[data-android-download-host]');if(!host)return;
 let dismissed=androidDownloadState.dismissed;
 try{dismissed=dismissed||sessionStorage.getItem(androidDownloadDismissKey)==='true'}catch{}
 if(dismissed||!androidDownloadState.url||!androidBrowserDownloadEligible()){host.replaceChildren();return}
 const url=new URL(androidDownloadState.url);
 host.innerHTML=`<aside class="android-download-banner" aria-label="Приложение для Android"><a class="android-download-link" href="${safe(url.href)}" target="_blank" rel="noopener noreferrer"${url.origin===location.origin&&url.pathname.endsWith('.apk')?' download="po-puti.apk"':''}>Скачать для Android</a><button type="button" class="android-download-close" data-android-download-close aria-label="Закрыть предложение скачать приложение">×</button></aside>`;
 host.querySelector('[data-android-download-close]').addEventListener('click',()=>{
  androidDownloadState.dismissed=true;
  try{sessionStorage.setItem(androidDownloadDismissKey,'true')}catch{}
  // Do not re-render the current form or change its URL when dismissing.
  host.replaceChildren();
 });
}
async function syncAndroidDownload(){
 paintAndroidDownload();
 if(androidDownloadState.requested)return androidDownloadState.pending;
 if(!androidBrowserDownloadEligible()||(!window.PO_PUTI_BACKEND&&!window.PO_PUTI_API_BASE))return;
 androidDownloadState.requested=true;
 androidDownloadState.pending=(async()=>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{
  const response=await fetch((window.PO_PUTI_API_BASE||'').replace(/\/$/,'')+'/api/public-config',{credentials:'omit',cache:'no-store',signal:controller.signal});
  if(!response.ok)return;
  const config=await response.json();
  if(typeof config.androidDownloadUrl!=='string'||!config.androidDownloadUrl.trim()||/[\u0000-\u0020\u007f\\]/.test(config.androidDownloadUrl))return;
  const url=new URL(config.androidDownloadUrl);
  if(url.protocol!=='https:'||url.username||url.password)return;
  androidDownloadState.url=url.href;
  paintAndroidDownload();
 }catch{ /* Optional banner failure must never block the application. */ }
 finally{clearTimeout(timer)}
 })();
 return androidDownloadState.pending;
}
for(const mode of ['standalone','fullscreen','minimal-ui','window-controls-overlay'])window.matchMedia?.('(display-mode: '+mode+')').addEventListener?.('change',paintAndroidDownload);
window.addEventListener('pageshow',paintAndroidDownload);

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
async function restoreNativeSession(){const bridge=nativeBridge();if(!bridge||cookieSession)return;try{const value=await bridge.getToken();if(value.token)accessToken=value.token;else if(accessToken)await bridge.setToken({token:accessToken});safeStorage.removeItem(TOKEN_STORE);if(accessToken){const fresh=await refreshRemote();if(fresh&&accessToken&&(location.hash==='#/login'||pendingPushPath)){navigate(consumePendingPushPath()||'/search');}}}catch{safeStorage.removeItem(TOKEN_STORE);toast('Защищённое хранилище недоступно. Войдите снова')}}
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
function unifiedSearchPage(){const items=unifiedResults();const ads=featureState.config?.ads.enabled;return `<main class="page"><div class="page-head"><h1>Куда едем?</h1><p>Попутчики и междугородние автобусы</p></div>${searchPanel()}${wantedLinks()}${adSlot('search')}<div class="segmented" aria-label="Тип поездки">${[['all','Все'],['private','Попутка'],['bus','Автобусы']].map(([v,label])=>`<button data-search-filter="${v}" class="${featureState.filter===v?'active':''}">${label}</button>`).join('')}</div>${featureState.filter!=='private'?busStatus()+placeChoices('from')+placeChoices('to'):''}<div class="trip-list">${items.length?items.map((r,i)=>(r.type==='bus_service'?busCard(r):rideCard(r))+(i===4?adSlot('results'):'')).join(''):empty('Подходящих поездок пока нет','Измените маршрут или дату. Отсутствие автобусного ответа не означает отсутствие рейсов.')}${items.length<5?adSlot('results'):''}</div>${featureState.filter!=='private'?raspCopyright():''}${featureState.privateCursor&&featureState.filter!=='bus'?'<button class="btn btn-ghost" data-more-private>Ещё частные поездки</button>':''}${featureState.filter!=='private'&&featureState.bus.nextOffset!=null?'<button class="btn btn-ghost" data-more-buses>Ещё автобусные рейсы</button>':''}${ads?`<section class="privacy-ads"><p>Реклама Яндекса загружается с вашего согласия.</p><button class="small-link" data-ad-consent="${featureState.consent?'false':'true'}">${featureState.consent?'Отключить рекламу':'Разрешить рекламу'}</button></section>`:''}<button class="btn btn-primary full" data-action="nav" data-route="/publish">Предложить поездку</button><a class="small-link" href="${safe(SERVER_BASE)}/privacy.html" target="_blank" rel="noopener">Конфиденциальность и источники данных</a></main>`}
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
  await bridge.addListener('search',data=>{db.search={from:data.from,to:data.to,date:data.date};featureState.filter=['all','private','bus'].includes(data.filter)?data.filter:'all';featureState.queryKey='';save();runUnifiedSearch()});
  await bridge.addListener('nativeSearchError',()=>{nativeSearchFailed=true;nativeSearchVisible=false;bridge.closeSearch().catch(()=>{})});
  await bridge.addListener('filter',data=>{if(typeof data.from==='string')db.search={from:data.from,to:data.to,date:data.date};save();featureState.filter=['all','private','bus'].includes(data.filter)?data.filter:'all';render()});
  await bridge.addListener('place',data=>{if(['from','to'].includes(data.side)){db.search[data.side+'Code']=data.code;save();runUnifiedSearch()}});
  await bridge.addListener('navigate',data=>{nativeSearchVisible=false;if(['trips','notifications','profile'].includes(data.route))navigate('/'+data.route)});
  await bridge.addListener('refreshSearch',()=>{featureState.queryKey='';runUnifiedSearch()});
  await bridge.addListener('morePrivate',loadMorePrivate);
  await bridge.addListener('more',()=>runUnifiedSearch(true));
  await bridge.addListener('adConsent',data=>{featureState.consent=data.granted===true;safeStorage.setItem(consentStorageKey(),String(featureState.consent));api('/privacy/consent','POST',{category:'advertising',granted:featureState.consent}).catch(()=>{});render()});
  await bridge.addListener('openRide',data=>{nativeSearchVisible=false;navigate('/ride/'+encodeURIComponent(data.id))});
  await bridge.addListener('wanted',()=>{nativeSearchVisible=false;navigate('/wanted-new')});
  await bridge.addListener('wantedList',()=>{nativeSearchVisible=false;navigate('/wanted')});
  await bridge.addListener('publish',()=>{nativeSearchVisible=false;navigate('/publish')});
  await bridge.addListener('closeSearch',()=>{nativeSearchVisible=false;navigate('/trips')});
 }
 if(!session||session!==accessToken||location.hash!=='#/search')return;
 const items=unifiedResults().map(r=>r.type==='bus_service'?r:{type:'private_ride',id:r.id,from:r.from,to:r.to,date:r.date,time:r.time,price:r.price,available:seatsLeft(r),driver:user(r.driverId).name,car:r.car});
 nativeSearchVisible=true;await bridge.showSearch({wantedEnabled:wantedState.enabled===true,query:db.search,filter:featureState.filter,items,choices:featureState.filter!=='private'?featureState.choices:{},hasMore:featureState.filter!=='private'&&featureState.bus.nextOffset!=null,hasMorePrivate:featureState.filter!=='bus'&&!!featureState.privateCursor,expiresAt:featureState.filter!=='private'?(featureState.bus.expiresAt||0):0,status:featureState.filter!=='private'?busStatus().replace(/<[^>]*>/g,''):'',ads:featureState.config?.ads||{enabled:false},consent:featureState.consent});if(session!==accessToken||location.hash!=='#/search'){nativeSearchVisible=false;await bridge.closeSearch()}
}
function privacyMarkup(){return `<section class="section-card"><h3>Конфиденциальность</h3><a href="${safe(SERVER_BASE)}/privacy.html" target="_blank" rel="noopener">Политика и источники данных</a><p><button class="small-link" data-request-deletion>Удалить аккаунт</button></p>${me()?.role==='admin'?'<button class="small-link" data-mfa-enroll>Настроить MFA администратора</button><p><button class="small-link" data-mfa-stepup>Подтвердить MFA</button></p>':''}</section>`}
document.addEventListener('change',e=>{
 if(e.target.name==='seriesMode'){setDraftFromForm();render()}
 if(e.target.dataset.placeChoice&&e.target.value){const side=e.target.dataset.placeChoice;db.search[side+'Code']=e.target.value;save();runUnifiedSearch()}
});
document.addEventListener('click',async e=>{
 const filter=e.target.closest('[data-search-filter]');if(filter){featureState.filter=['all','private','bus'].includes(filter.dataset.searchFilter)?filter.dataset.searchFilter:'all';render()}
 if(e.target.closest('[data-more-private]'))loadMorePrivate();
 if(e.target.closest('[data-more-buses]'))runUnifiedSearch(true);
 const consent=e.target.closest('[data-ad-consent]');if(consent){featureState.consent=consent.dataset.adConsent==='true';safeStorage.setItem(consentStorageKey(),String(featureState.consent));api('/privacy/consent','POST',{category:'advertising',granted:featureState.consent}).catch(()=>{}).finally(()=>{if(!featureState.consent&&!window.Capacitor)location.reload()});render()}
 const ticket=e.target.closest('[data-ticket-url]');if(ticket&&nativeBridge()){e.preventDefault();nativeBridge().openExternal({url:ticket.dataset.ticketUrl}).catch(()=>toast('Не удалось открыть ссылку'))}
 if(e.target.closest('[data-request-deletion]'))showModal('Удаление аккаунта',`<p>Действие необратимо. Профиль и фотографии удаляются, будущие поездки и заявки отменяются, все устройства выходят из аккаунта. Тексты переписки с вами и связанных отзывов обезличиваются. Оценки, даты и факты поездок сохраняются. Старые резервные копии изолированы и повторно обезличиваются перед восстановлением сервиса.</p><form id="account-delete-form" class="stack"><label class="field">Подтвердите пароль<input type="password" name="password" required autocomplete="current-password" minlength="8" maxlength="128"></label><label><input type="checkbox" name="confirmed" required> Понимаю последствия и хочу удалить свой аккаунт</label><button class="btn btn-danger" type="submit">Удалить аккаунт навсегда</button></form>`,'');
 if(e.target.closest('[data-mfa-stepup]'))showModal('Подтверждение MFA','<form id="mfa-enable"><label>Код<input name="code" inputmode="numeric" pattern="[0-9]{6}" required autocomplete="one-time-code"></label><button class="btn btn-primary" type="submit">Подтвердить</button></form>','');
 if(e.target.closest('[data-mfa-enroll]'))showModal('Подтвердите пароль','<form id="mfa-enroll-password"><label>Пароль<input name="password" type="password" required autocomplete="current-password"></label><button class="btn btn-primary" type="submit">Продолжить</button></form>','');
});
document.addEventListener('submit',async e=>{ if(e.target.id==='mfa-enroll-password'){e.preventDefault();try{const setup=await api('/admin/mfa/enroll','POST',{password:new FormData(e.target).get('password')});showModal('MFA администратора',`Добавьте секрет в приложение-аутентификатор: <code>${safe(setup.secret)}</code><form id="mfa-enable"><label>Код<input name="code" inputmode="numeric" pattern="[0-9]{6}" required autocomplete="one-time-code"></label><button class="btn btn-primary" type="submit">Включить</button></form>`,'')}catch(err){toast(err.message)}}if(e.target.id!=='mfa-enable')return;e.preventDefault();try{await api('/admin/mfa/verify','POST',{code:new FormData(e.target).get('code')});hideModal();toast('MFA подтверждена')}catch(err){toast(err.message)}});

function seriesManagementMarkup(){return (featureState.series||[]).map(s=>`<section class="section-card"><h3>Регулярные поездки</h3><p>${safe(s.startDate)} — ${safe(s.endDate)} · ${safe(s.time)}</p><button class="small-link" data-edit-series="${safe(s.id)}">Изменить будущие отправления без заявок</button><p><button class="small-link" data-renew-series="${safe(s.id)}">Создать новую серию</button></p><button class="small-link" data-cancel-series="${safe(s.id)}">Отменить оставшиеся отправления</button></section>`).join('')}
document.addEventListener('submit',async e=>{
 if(e.target.id!=='account-delete-form')return;e.preventDefault();const form=e.target,button=form.querySelector('button[type="submit"]'),data=new FormData(form);if(!data.get('confirmed'))return;
 button.disabled=true;const token=accessToken,consentKey=consentStorageKey();
 try{const result=await api('/account/delete','POST',{confirmation:'DELETE_MY_ACCOUNT',password:data.get('password')});form.reset();if(token!==accessToken)return;pendingPushPath=null;db.search={from:'',to:'',date:today(1)};db.searchSubmitted=false;safeStorage.removeItem(consentKey);clearRemoteSession();safeStorage.removeItem('po-puti-ui-v2');hideModal();navigate('/login');showModal('Аккаунт удалён',`<p>Сохраните номер подтверждения: <code>${safe(result.receiptId)}</code>.</p><p>Персональные данные обезличены.${result.mediaCleanupPending?' Файлы недоступны; физическая очистка будет повторена автоматически.':''}</p>`,'')}
 catch(error){button.disabled=false;form.querySelector('[name="password"]').value='';toast(error.message)}
});
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

// Shared passenger request screens: Android opens this same WebView controller.
const wantedState={enabled:null,token:null,checked:0,loading:false,items:null,mine:null,error:'',key:'',offset:null};
async function wantedConfig(force=false){
 if(!remoteMode||!accessToken||wantedState.loading||(!force&&wantedState.token===accessToken&&Date.now()-wantedState.checked<15000))return;
 wantedState.loading=true;const token=accessToken;
 try{const c=await api('/wanted-config');if(token!==accessToken)return;if(wantedState.token!==token){wantedState.items=null;wantedState.mine=null}const changed=wantedState.token!==token||wantedState.enabled!==c.enabled;wantedState.token=token;wantedState.enabled=c.enabled;wantedState.checked=Date.now();if(changed)render()}
 catch{if(token===accessToken){wantedState.enabled=false;wantedState.checked=Date.now()}}
 finally{wantedState.loading=false}
}
function wantedLinks(){Promise.resolve().then(()=>wantedConfig());return wantedState.token===accessToken&&wantedState.enabled?'<div class="actions"><button class="btn btn-primary" data-wanted-nav="wanted-new">Ищу попутку</button><button class="btn btn-ghost" data-wanted-nav="wanted">Заявки пассажиров</button></div>':''}
function wantedAdminMarkup(){Promise.resolve().then(()=>wantedConfig());return `<section class="section-card"><h3>Ищу попутку</h3><button class="btn btn-ghost" data-wanted-toggle ${wantedState.enabled===null?'disabled':''}>${wantedState.enabled?'Выключить':'Включить'}</button></section>`}
async function loadWanted(more=false){
 if(!more&&wantedState.error)return;
 const token=accessToken,q=db.search||{},key=JSON.stringify([token,q]);if(wantedState.fetching)return;if(!more&&wantedState.key===key&&wantedState.items!==null)return;
 wantedState.fetching=true;wantedState.error='';
 try{const args=new URLSearchParams({from:q.from||'',to:q.to||'',date:q.date||''});if(more)args.set('offset',wantedState.offset);const [list,mine]=await Promise.all([api('/wanted?'+args),api('/wanted?mine=1')]);if(token!==accessToken)return;wantedState.items=more?[...wantedState.items,...list.items]:list.items;wantedState.mine=mine.items;wantedState.offset=list.nextOffset;wantedState.key=key;}
 catch(e){if(token===accessToken)wantedState.error=e.message}
 finally{wantedState.fetching=false;if(token===accessToken&&location.hash==='#/wanted')render()}
}
function wantedPage(route){
 Promise.resolve().then(()=>wantedConfig());
 if(!accessToken)return '<main class="page">Войдите в аккаунт</main>';
 if(wantedState.token!==accessToken||wantedState.enabled!==true)return '<main class="page"><h1>Ищу попутку</h1><p>Функция недоступна или ещё загружается.</p><button data-wanted-retry class="btn">Повторить</button></main>';
 if(route==='wanted-new'){const q=db.search||{};return `<main class="page"><h1>Ищу попутку</h1><form id="wanted-form" class="stack"><label class="field">Откуда<input name="from" required maxlength="100" value="${safe(q.from||'')}"></label><label class="field">Куда<input name="to" required maxlength="100" value="${safe(q.to||'')}"></label><label class="field">Дата<input name="date" type="date" required value="${safe(q.date||today(1))}"></label><label class="field">Желаемое время<input name="time" type="time" required></label><label class="field">Часовой пояс отправления<input name="timeZone" required value="${safe(Intl.DateTimeFormat().resolvedOptions().timeZone)}"></label><label class="field">Количество пассажиров<input name="passengers" type="number" min="1" max="7" value="1" required></label><label class="field">Комментарий<textarea name="comment" maxlength="500"></textarea></label><p>Контакты не публикуются. Общение доступно через обычное бронирование предложенной поездки.</p><button type="submit" class="btn btn-primary">Опубликовать заявку</button><p data-wanted-error role="alert"></p></form></main>`}
 Promise.resolve().then(()=>loadWanted());
 const card=w=>`<section class="section-card"><h3>${safe(w.from)} → ${safe(w.to)}</h3><p>${safe(w.date)} · ${safe(w.time)} (${safe(w.timeZone)}) · ${w.passengers} пасс.</p><p>${safe(w.comment)}</p><p>${safe(({active:'Активна',cancelled:'Отменена',completed:'Завершена'})[w.status])}</p>${w.mine&&w.status==='active'?`<button class="btn" data-wanted-cancel="${safe(w.id)}">Отменить</button><button class="btn" data-wanted-edit="${safe(w.id)}">Изменить комментарий</button>`:!w.mine&&w.status==='active'?`<button class="btn" data-wanted-offer="${safe(w.id)}">Предложить свою поездку</button>`:''}${w.offers.map(o=>`<p><button class="small-link" data-action="open-ride" data-id="${safe(o.rideId)}">Посмотреть предложенную поездку</button></p>`).join('')}</section>`;
 return `<main class="page"><h1>Заявки пассажиров</h1>${wantedLinks()}<p>Подбор по маршруту и дате главного поиска.</p>${wantedState.error?`<p role="alert">${safe(wantedState.error)}</p><button data-wanted-retry>Повторить</button>`:''}<h2>Мои заявки</h2>${(wantedState.mine||[]).map(card).join('')||'<p>Нет заявок</p>'}<h2>Подходящие заявки</h2>${(wantedState.items||[]).map(card).join('')||'<p>Подходящих заявок нет</p>'}${wantedState.offset!==null?'<button data-wanted-more>Ещё заявки</button>':''}</main>`;
}
document.addEventListener('submit',async e=>{if(e.target.id!=='wanted-form')return;e.preventDefault();const form=e.target,b=form.querySelector('button[type=submit]');b.disabled=true;try{await api('/wanted','POST',Object.fromEntries(new FormData(form)));wantedState.key='';wantedState.items=null;navigate('/wanted')}catch(err){form.querySelector('[data-wanted-error]').textContent=err.message}finally{b.disabled=false}});
document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-wanted-nav],[data-wanted-toggle],[data-wanted-retry],[data-wanted-more],[data-wanted-cancel],[data-wanted-edit],[data-wanted-offer],[data-wanted-send]');if(!el)return;
 try{
  if(el.hasAttribute('data-wanted-nav'))return navigate('/'+el.dataset.wantedNav);
  if(el.hasAttribute('data-wanted-toggle')){await api('/admin/wanted','POST',{enabled:!wantedState.enabled});await wantedConfig(true);return}
  if(el.hasAttribute('data-wanted-retry')){wantedState.key='';wantedState.error='';await wantedConfig(true);return loadWanted()}
  if(el.hasAttribute('data-wanted-more'))return loadWanted(true);
  if(el.dataset.wantedCancel)await api('/wanted/'+encodeURIComponent(el.dataset.wantedCancel)+'/cancel','POST',{});
  if(el.dataset.wantedEdit){const w=wantedState.mine.find(w=>w.id===el.dataset.wantedEdit);const comment=prompt('Комментарий без контактов',w.comment);if(comment===null)return;await api('/wanted/'+encodeURIComponent(w.id)+'/update','POST',{comment})}
  if(el.dataset.wantedOffer){const w=wantedState.items.find(w=>w.id===el.dataset.wantedOffer),rides=db.rides.filter(r=>r.driverId===db.currentUserId&&!r.cancelled&&r.date===w.date&&r.from.toLocaleLowerCase('ru')===w.from.toLocaleLowerCase('ru')&&r.to.toLocaleLowerCase('ru')===w.to.toLocaleLowerCase('ru')&&seatsLeft(r)>=w.passengers);return showModal('Предложить поездку',rides.length?rides.map(r=>`<p><button class="btn" data-wanted-send="${safe(w.id)}" data-ride="${safe(r.id)}">${safe(r.from)} → ${safe(r.to)} · ${safe(r.time)}</button></p>`).join(''):'<p>Нет подходящих поездок. Опубликуйте поездку с этим маршрутом и датой.</p>','')}
  if(el.dataset.wantedSend){await api('/wanted/'+encodeURIComponent(el.dataset.wantedSend)+'/offer','POST',{rideId:el.dataset.ride});hideModal();toast('Предложение отправлено')}
  wantedState.key='';await loadWanted();
 }catch(err){toast(err.message)}
});
setInterval(()=>{if(document.visibilityState==='visible'&&accessToken){wantedConfig();if(location.hash==='#/wanted'){wantedState.key='';loadWanted()}}},15000);

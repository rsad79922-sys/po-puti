/* Public distribution page; never redirects, downloads or prompts without a tap. */
(()=>{
 const ua=navigator.userAgent||'',ios=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1);
 const installedWeb=navigator.standalone===true||window.matchMedia?.('(display-mode: standalone)').matches;
 // Referrers from scanners/messengers and WebView UAs do not identify our APK.
 // An installed PWA is also a separate app: this explicit install page must
 // still let its Android user choose the native APK. The in-app banner keeps
 // its own stricter visibility rules.
 const native=window.Capacitor?.getPlatform?.()==='android'&&window.Capacitor?.isNativePlatform?.()===true;
 const android=!ios&&!native&&(/Android/i.test(ua)||navigator.userAgentData?.platform==='Android');
 const text=document.getElementById('pwa-instructions'),button=document.getElementById('pwa-install');
 let prompt=null;
 if(native)text.textContent='Вы открыли страницу в Android-приложении «По пути». Проверить обновления можно в профиле.';
 else if(installedWeb)text.textContent=android?'Веб-приложение уже открыто отдельным окном. Приложение Android можно скачать кнопкой выше.':'Веб-приложение уже открыто отдельным окном. Перейдите на главную страницу.';
 else if(ios)text.textContent='В Safari нажмите «Поделиться» → «На экран Домой» → «Добавить». Если вы открыли ссылку в другом приложении, сначала откройте её в Safari.';
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();if(native||installedWeb)return;prompt=event;button.hidden=false;});
 button.addEventListener('click',async()=>{if(!prompt)return;const event=prompt;prompt=null;button.hidden=true;try{await event.prompt();const choice=await event.userChoice;text.textContent=choice.outcome==='accepted'?'Установка запущена. Значок появится на главном экране.':'Установить можно позднее через меню браузера.';}catch{text.textContent='Выберите «Установить приложение» или «На главный экран» в меню браузера.';}});
 window.addEventListener('appinstalled',()=>{button.hidden=true;prompt=null;text.textContent='Приложение установлено. Открывайте По пути с главного экрана.';});
 if('serviceWorker' in navigator&&!native)navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
 if(!android)return;
 document.getElementById('android-install').hidden=false;
 const status=document.getElementById('apk-status'),link=document.getElementById('apk-download');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 fetch('/api/public-config',{credentials:'omit',cache:'no-store',signal:controller.signal}).then(async response=>{
  if(!response.ok)throw Error();const config=await response.json(),value=config.androidDownloadUrl;
  if(typeof value!=='string'||!value||/[\u0000-\u0020\u007f\\]/.test(value))throw Error();
  const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw Error();
  link.href=url.href;if(url.origin===location.origin&&url.pathname.endsWith('.apk'))link.download='po-puti.apk';link.hidden=false;
  status.textContent='Скачивание начнётся только после нажатия кнопки.';
 }).catch(()=>{status.textContent='Ссылка скачивания сейчас недоступна. Откройте веб-приложение или попробуйте позже.';}).finally(()=>clearTimeout(timer));
})();

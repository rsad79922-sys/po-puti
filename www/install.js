/* Public distribution page; never redirects, downloads or prompts without a tap. */
(()=>{
 const ua=navigator.userAgent||'',ios=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1);
 const installed=navigator.standalone===true||['standalone','fullscreen','minimal-ui'].some(mode=>matchMedia('(display-mode: '+mode+')').matches);
 const native=!!window.Capacitor||/\bwv\b/i.test(ua)||document.referrer.startsWith('android-app://');
 const android=/Android/i.test(ua)&&!ios&&!native&&!installed&&(!navigator.userAgentData?.platform||navigator.userAgentData.platform==='Android');
 const text=document.getElementById('pwa-instructions'),button=document.getElementById('pwa-install');
 let prompt=null;
 if(installed||native)text.textContent='Приложение уже открыто в установленном режиме. Перейдите на главную страницу.';
 else if(ios)text.textContent='В Safari нажмите «Поделиться» → «На экран Домой» → «Добавить». Если вы открыли ссылку в другом приложении, сначала откройте её в Safari.';
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();if(native||installed)return;prompt=event;button.hidden=false;});
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

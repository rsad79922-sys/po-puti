/* Shared API for native Android; the production PWA uses same-origin /api. */
(function(){
  var nativeAndroid=!!(window.Capacitor && typeof window.Capacitor.getPlatform==='function' && window.Capacitor.getPlatform()==='android');
  window.PO_PUTI_BACKEND=nativeAndroid;
  window.PO_PUTI_API_BASE=nativeAndroid?'https://vputipoputka.ru':'';
})();

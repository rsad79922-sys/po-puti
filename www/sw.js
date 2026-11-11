/* По пути: updated network-first PWA shell. API responses are never cached. */
const CACHE='po-puti-shell-v3';
const SHELL=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('po-puti-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event=>{
 const req=event.request;
 const url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname.startsWith('/api/')||url.pathname.endsWith('/config.js'))return;
 if(req.mode==='navigate'){
   event.respondWith(fetch(req).then(res=>{
     if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put('./index.html',copy)).catch(()=>{});}
     return res;
   }).catch(()=>caches.match('./index.html')));
   return;
 }
 event.respondWith(fetch(req).then(res=>{
   if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});}
   return res;
 }).catch(()=>caches.match(req)));
});

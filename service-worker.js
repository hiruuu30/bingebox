const CACHE='bingebox-shell-v28-playback-resilient';
const SHELL=['/', '/index.html', '/watch.html', '/swipe.html', '/lite.html', '/offline.html', '/exact-desktop.css', '/clone-runtime.css', '/bingebox-exact.css', '/config.js', '/poster-fallback.js', '/bingebox-injection.js', '/clone-runtime.js', '/bingebox-polish.js', '/pwa.js?v=1900', '/watch.css?v=2470', '/watch.js?v=20260922resilient2', '/user.js?v=2470', '/donate.css?v=2470', '/donate.js?v=2470', '/lite.css?v=2470', '/lite.js?v=2470', '/push.js?v=1900', '/manifest.webmanifest', '/assets/brand/mark.svg', '/assets/brand/wordmark-hd.png', '/assets/brand/favicon.svg', '/assets/brand/apple-touch-icon.png', '/assets/brand/pwa-192.png', '/assets/brand/pwa-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('bingebox-shell-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url);if(url.origin!==location.origin)return;
  if(url.pathname.startsWith('/workspace')||url.pathname==='/config.js'||url.pathname.startsWith('/api/'))return;
  if(url.pathname==='/bingebox-injection.js'||url.pathname==='/lite.js'||url.pathname==='/watch.js'){
    event.respondWith(fetch(req,{cache:'no-store'}).then(res=>{if(res.ok){const clone=res.clone();caches.open(CACHE).then(c=>c.put(req,clone))}return res}).catch(()=>caches.match(req)));return;
  }
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{const clone=res.clone();caches.open(CACHE).then(c=>c.put(req,clone));return res}).catch(async()=>await caches.match(req)||await caches.match('/offline.html')));return;
  }
  if(/\.(?:css|js|svg|png|jpg|jpeg|webp|webmanifest)$/i.test(url.pathname)){
    event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{if(res.ok){const clone=res.clone();caches.open(CACHE).then(c=>c.put(req,clone))}return res})));}
});


self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json?.()||{}}catch{data={body:event.data?.text?.()||''}}
  const title=String(data.title||'BingeBox');
  const options={body:String(data.body||'A new BingeBox update is ready.'),icon:'/assets/brand/pwa-192.png',badge:'/assets/brand/pwa-192.png',tag:String(data.tag||'bingebox-update'),data:{url:String(data.url||'/')},renotify:false};
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const raw=event.notification?.data?.url||'/';
  const target=new URL(raw,self.location.origin).href;
  event.waitUntil((async()=>{
    const wins=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const win of wins){if('focus'in win){await win.focus();if('navigate'in win)await win.navigate(target);return}}
    if(clients.openWindow)return clients.openWindow(target);
  })());
});

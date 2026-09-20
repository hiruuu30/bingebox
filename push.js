(()=>{
  const config=window.BINGEBOX_CONFIG||{};
  const base=(config.supabaseUrl||'').replace(/\/$/,'');
  if(!base)return;
  const endpoint=`${base}/functions/v1/push-api`;
  const key=config.supabasePublishableKey||'';
  const $all=s=>[...document.querySelectorAll(s)];
  let busy=false;
  const bytes=b64=>{const pad='='.repeat((4-b64.length%4)%4),raw=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw],c=>c.charCodeAt(0))};
  function toast(msg){let el=document.querySelector('.push-toast');if(!el){el=document.createElement('div');el.className='push-toast';el.setAttribute('role','status');document.body.appendChild(el)}el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),3300)}
  function supported(){return 'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window}
  function iosNeedsInstall(){const ua=navigator.userAgent||'';const ios=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);const standalone=matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;return ios&&!standalone}
  async function subscription(){if(!supported())return null;try{return await (await navigator.serviceWorker.ready).pushManager.getSubscription()}catch{return null}}
  async function update(){const sub=await subscription();$all('[data-push-toggle]').forEach(btn=>{const lab=btn.querySelector('[data-push-label]');const on=!!sub&&Notification.permission==='granted';btn.dataset.pushOn=on?'1':'0';btn.setAttribute('aria-pressed',on?'true':'false');if(lab)lab.textContent=on?'Updates on':'Get updates';else btn.textContent=on?'Updates on':'Get updates'})}
  async function api(action,body=null){const h={'Content-Type':'application/json',apikey:key,...(window.BBUser?.getAuthHeader?.()||{})};const res=await fetch(`${endpoint}?action=${encodeURIComponent(action)}`,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data?.error||`Notification service error (${res.status})`);return data}
  async function enable(){if(!supported())throw new Error('Push notifications are not supported by this browser.');if(iosNeedsInstall())throw new Error('On iPhone, install BingeBox to your Home Screen first, then enable updates from the installed app.');let permission=Notification.permission;if(permission==='default')permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notifications are blocked. Enable them in your browser or device settings.');const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();if(!sub){const cfg=await api('config');sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(cfg.publicKey)})}await api('subscribe',{action:'subscribe',subscription:sub.toJSON(),visitorToken:window.BBUser?.visitorToken?.()||null});toast('BingeBox updates are on.');await update()}
  async function disable(){const sub=await subscription();if(!sub)return update();try{await api('unsubscribe',{action:'unsubscribe',endpoint:sub.endpoint})}catch{}await sub.unsubscribe();toast('BingeBox updates are off.');await update()}
  document.addEventListener('click',async e=>{const btn=e.target.closest('[data-push-toggle]');if(!btn||busy)return;e.preventDefault();busy=true;try{const sub=await subscription();if(sub&&Notification.permission==='granted')await disable();else await enable()}catch(err){toast(err.message||'Unable to change notification settings.')}finally{busy=false}});
  window.addEventListener('bb-auth-changed',()=>update());
  window.addEventListener('load',()=>update(),{once:true});
  document.addEventListener('DOMContentLoaded',()=>update(),{once:true});
  window.BBPush={update,enable,disable,supported};
})();

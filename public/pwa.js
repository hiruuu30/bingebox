(()=>{
  let deferredPrompt=null;
  const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone===true;
  const emit=()=>window.dispatchEvent(new CustomEvent('bb-pwa-change',{detail:{canPrompt:!!deferredPrompt,standalone:isStandalone()}}));
  const platform=()=>{
    const ua=navigator.userAgent||'';
    const ios=/iPad|iPhone|iPod/.test(ua) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
    const android=/Android/i.test(ua);
    const edge=/Edg\//.test(ua);
    const chrome=/(Chrome|CriOS)\//.test(ua) && !edge;
    const safari=/Safari\//.test(ua) && !/(Chrome|CriOS|Edg|OPR)\//.test(ua);
    return {ios,android,edge,chrome,safari};
  };
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;emit();});
  window.addEventListener('appinstalled',()=>{deferredPrompt=null;emit();});
  window.BBPWA={
    isStandalone,
    platform,
    canPrompt:()=>!!deferredPrompt,
    async prompt(){
      if(!deferredPrompt)return {outcome:'unavailable'};
      const prompt=deferredPrompt;
      deferredPrompt=null;
      try{
        await prompt.prompt();
        const choice=await prompt.userChoice;
        emit();
        return choice||{outcome:'dismissed'};
      }catch(_){emit();return {outcome:'error'};}
    }
  };
  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js',{scope:'/'}).then(()=>emit()).catch(()=>emit()),{once:true});
  }
  window.addEventListener('DOMContentLoaded',emit,{once:true});
  emit();
})();

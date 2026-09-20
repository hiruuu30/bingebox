(() => {
  const config = window.BINGEBOX_CONFIG || {};
  const base = (config.supabaseUrl || '').replace(/\/$/, '');
  const key = config.supabasePublishableKey || '';
  const storageKey = 'bb-user-session';
  let session = null;
  let profile = null;
  let favorites = new Set();
  let cloudProgress = new Map();
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });

  const parseJSON = value => { try { return JSON.parse(value); } catch { return null; } };
  const visitorToken = () => {
    const k='bb-visitor-token';
    try {
      let v=localStorage.getItem(k);
      if(v) return v;
      v=crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,n=c==='x'?r:(r&3|8);return n.toString(16)});
      localStorage.setItem(k,v); return v;
    } catch { return '00000000-0000-4000-8000-000000000001'; }
  };

  function authHeaders(json=true){
    return {
      apikey:key,
      ...(session?.access_token ? {Authorization:`Bearer ${session.access_token}`} : {}),
      ...(json ? {'Content-Type':'application/json'} : {}),
      Accept:'application/json'
    };
  }

  async function request(path, options={}){
    if(!base || !key) throw new Error('BingeBox account services are unavailable.');
    const res=await fetch(`${base}${path}`,{...options,headers:{...authHeaders(options.json!==false),...(options.headers||{})},cache:options.cache||'no-store'});
    const text=await res.text();
    const data=text?parseJSON(text):null;
    if(!res.ok) throw new Error(data?.msg||data?.message||data?.error_description||data?.error||`Request failed (${res.status})`);
    return data;
  }

  function persistSession(next){
    session=next||null;
    try { if(session) localStorage.setItem(storageKey,JSON.stringify(session)); else localStorage.removeItem(storageKey); } catch {}
  }

  async function refreshIfNeeded(){
    if(!session?.refresh_token) return false;
    if((session.expires_at||0)*1000 > Date.now()+60000) return true;
    try {
      const res=await fetch(`${base}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token}),cache:'no-store'});
      const data=await res.json();
      if(!res.ok) throw new Error(data?.message||'Session expired');
      data.expires_at=Math.floor(Date.now()/1000)+(data.expires_in||3600);
      persistSession(data); return true;
    } catch { persistSession(null); return false; }
  }

  async function hydrateUserData(){
    if(!session?.access_token){ profile=null; favorites=new Set(); cloudProgress=new Map(); return; }
    await refreshIfNeeded();
    if(!session?.access_token) return;
    try {
      const [user, profiles, favRows, progressRows]=await Promise.all([
        request('/auth/v1/user'),
        request('/rest/v1/profiles?select=user_id,display_name&limit=1'),
        request('/rest/v1/favorites?select=drama_id'),
        request('/rest/v1/watch_progress?select=episode_id,drama_id,seconds,duration,completed,updated_at')
      ]);
      session.user=user; persistSession(session);
      profile=profiles?.find(p=>p.user_id===user.id)||profiles?.[0]||{user_id:user.id,display_name:(user.email||'').split('@')[0]};
      favorites=new Set((favRows||[]).map(r=>r.drama_id));
      cloudProgress=new Map((progressRows||[]).map(r=>[r.episode_id,r]));
    } catch (err) {
      if(/JWT|expired|session|token/i.test(err.message||'')) persistSession(null);
    }
  }

  async function init(){
    try { const saved=parseJSON(localStorage.getItem(storageKey)); if(saved) session=saved; } catch {}
    if(session) await hydrateUserData();
    readyResolve(true);
    window.dispatchEvent(new CustomEvent('bb-auth-changed',{detail:getState()}));
  }

  function getState(){
    return {signedIn:!!session?.access_token,user:session?.user||null,profile,session};
  }

  async function signIn(email,password){
    const res=await fetch(`${base}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password}),cache:'no-store'});
    const data=await res.json();
    if(!res.ok) throw new Error(data?.message||data?.error_description||'Sign in failed.');
    data.expires_at=Math.floor(Date.now()/1000)+(data.expires_in||3600);
    persistSession(data); await hydrateUserData();
    window.dispatchEvent(new CustomEvent('bb-auth-changed',{detail:getState()}));
    return getState();
  }

  async function signUp(email,password,displayName=''){
    const redirect=`${location.origin}/`;
    const res=await fetch(`${base}/auth/v1/signup?redirect_to=${encodeURIComponent(redirect)}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password,data:{display_name:displayName.trim()}}),cache:'no-store'});
    const data=await res.json();
    if(!res.ok) throw new Error(data?.message||data?.error_description||'Account creation failed.');
    if(data.access_token){
      data.expires_at=Math.floor(Date.now()/1000)+(data.expires_in||3600);
      persistSession(data); await hydrateUserData();
      window.dispatchEvent(new CustomEvent('bb-auth-changed',{detail:getState()}));
    }
    return {confirmed:!!data.access_token,data};
  }

  async function signOut(){
    try { if(session?.access_token) await request('/auth/v1/logout',{method:'POST'}); } catch {}
    persistSession(null); profile=null; favorites=new Set(); cloudProgress=new Map();
    window.dispatchEvent(new CustomEvent('bb-auth-changed',{detail:getState()}));
  }

  function localFavoriteSlugs(){
    try { const v=parseJSON(localStorage.getItem('bb-local-favorites')); return new Set(Array.isArray(v)?v:[]); } catch { return new Set(); }
  }
  function saveLocalFavoriteSlugs(set){ try { const value=JSON.stringify([...set]);localStorage.setItem('bb-local-favorites',value);localStorage.setItem('bb-exact-favorites',value);window.dispatchEvent(new CustomEvent('bb-exact-favorites-changed')); } catch {} }

  function isFavorite(dramaDbId,slug){
    return session?.access_token ? favorites.has(dramaDbId) : localFavoriteSlugs().has(slug);
  }

  async function toggleFavorite(dramaDbId,slug){
    if(session?.access_token){
      await refreshIfNeeded();
      if(favorites.has(dramaDbId)){
        await request(`/rest/v1/favorites?drama_id=eq.${encodeURIComponent(dramaDbId)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
        favorites.delete(dramaDbId); return false;
      }
      await request('/rest/v1/favorites',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({user_id:session.user.id,drama_id:dramaDbId})});
      favorites.add(dramaDbId); track('favorite_add',{dramaId:dramaDbId}).catch(()=>{}); return true;
    }
    const local=localFavoriteSlugs();
    if(local.has(slug)){local.delete(slug);saveLocalFavoriteSlugs(local);return false;}
    local.add(slug);saveLocalFavoriteSlugs(local);track('favorite_add',{dramaId:dramaDbId}).catch(()=>{});return true;
  }

  function getFavoriteDramaIds(){ return new Set(favorites); }
  function getLocalFavoriteSlugs(){ return localFavoriteSlugs(); }
  function getProgress(episodeId){ return cloudProgress.get(episodeId)||null; }
  function getProgressRows(){ return [...cloudProgress.values()].sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0)); }

  async function saveProgress({episodeId,dramaId,seconds=0,duration=0,completed=false}){
    if(!session?.access_token || !episodeId || !dramaId) return false;
    await refreshIfNeeded(); if(!session?.access_token) return false;
    const row={user_id:session.user.id,episode_id:episodeId,drama_id:dramaId,seconds:Math.max(0,Math.floor(seconds||0)),duration:Math.max(0,Math.floor(duration||0)),completed:!!completed,updated_at:new Date().toISOString()};
    await request('/rest/v1/watch_progress?on_conflict=user_id,episode_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(row)});
    cloudProgress.set(episodeId,row); return true;
  }

  async function mergeLocalState(dramas=[]){
    if(!session?.access_token) return;
    await refreshIfNeeded(); if(!session?.access_token) return;
    const localFav=localFavoriteSlugs();
    for(const d of dramas){
      if(localFav.has(d.id) && d.dbId && !favorites.has(d.dbId)){
        try { await request('/rest/v1/favorites',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({user_id:session.user.id,drama_id:d.dbId})}); favorites.add(d.dbId); } catch {}
      }
      for(const ep of d.episodeItems||[]){
        let sec=0; try { sec=Number(localStorage.getItem(`bb-progress:${d.id}:${ep.episode_number}`)||0); } catch {}
        const cloud=cloudProgress.get(ep.id);
        if(sec>5 && (!cloud || sec>Number(cloud.seconds||0))){
          try { await saveProgress({episodeId:ep.id,dramaId:d.dbId,seconds:sec,duration:Number(ep.duration_seconds||0),completed:false}); } catch {}
        }
      }
    }
    if(localFav.size){ try { localStorage.removeItem('bb-local-favorites'); } catch {} }
  }

  function analyticsContext(){
    let referrer='direct';
    try{if(document.referrer){const u=new URL(document.referrer);referrer=u.hostname===location.hostname?'internal':u.hostname.replace(/^www\./,'');}}catch{}
    const width=Math.max(document.documentElement.clientWidth||0,window.innerWidth||0);
    const device=width<=680?'mobile':width<=1100?'tablet':'desktop';
    const ua=navigator.userAgent||'';
    const browser=/Edg\//.test(ua)?'Edge':/OPR\//.test(ua)?'Opera':/Chrome\//.test(ua)?'Chrome':/Firefox\//.test(ua)?'Firefox':/Safari\//.test(ua)&&!/Chrome\//.test(ua)?'Safari':'Other';
    const os=/Windows NT/.test(ua)?'Windows':/Android/.test(ua)?'Android':/iPhone|iPad|iPod/.test(ua)?'iOS/iPadOS':/Mac OS X/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'Other';
    let timezone='unknown'; try{timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'unknown'}catch{}
    const language=(navigator.language||'unknown').slice(0,24);
    const screenClass=width<=430?'small':width<=820?'medium':width<=1440?'large':'xlarge';
    return {device,referrer,page:location.pathname,browser,os,timezone,language,screen:screenClass};
  }

  async function track(eventType,{dramaId=null,episodeId=null,value=null,metadata={}}={}){
    if(!base || !key) return false;
    try{
      await refreshIfNeeded();
      const merged={...analyticsContext(),...(metadata||{})};
      const res=await fetch(`${base}/rest/v1/rpc/track_bingebox_event`,{method:'POST',headers:authHeaders(),body:JSON.stringify({p_event_type:eventType,p_drama_id:dramaId,p_episode_id:episodeId,p_visitor_token:visitorToken(),p_value_numeric:value,p_metadata:merged}),cache:'no-store'});
      return res.ok;
    }catch{return false;}
  }

  function getAuthHeader(){ return session?.access_token ? {Authorization:`Bearer ${session.access_token}`} : {}; }

  window.BBUser={ready,getState,signIn,signUp,signOut,isFavorite,toggleFavorite,getFavoriteDramaIds,getLocalFavoriteSlugs,getProgress,getProgressRows,saveProgress,mergeLocalState,track,visitorToken,getAuthHeader,refresh:hydrateUserData};
  init();
})();

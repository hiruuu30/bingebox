(() => {
  const $ = s => document.querySelector(s);
  const esc = (v='') => String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const cfg = window.BINGEBOX_CONFIG || {};
  const base = (cfg.supabaseUrl || 'https://shffgnuprnycqblpwkrp.supabase.co').replace(/\/$/,'');
  const key = cfg.supabasePublishableKey || 'sb_publishable_PeopMn9aiDdzxqLvSkkR6w_PUw9BIJH';
  const storageKey = 'bingebox_admin_session';
  let busy=false;
  let timer=null;

  function session(){
    try{return JSON.parse(localStorage.getItem(storageKey)||'null')}catch{return null}
  }
  async function freshSession(){
    let s=session();
    if(!s?.access_token)return null;
    if((Number(s.expires_at||0)*1000)>Date.now()+60000)return s;
    if(!s.refresh_token)return s;
    try{
      const res=await fetch(base+'/auth/v1/token?grant_type=refresh_token',{
        method:'POST',
        headers:{apikey:key,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:s.refresh_token}),
        cache:'no-store'
      });
      if(!res.ok)return s;
      const next=await res.json();
      next.expires_at=Math.floor(Date.now()/1000)+Number(next.expires_in||3600);
      if(!next.user&&s.user)next.user=s.user;
      localStorage.setItem(storageKey,JSON.stringify(next));
      return next;
    }catch{return s}
  }
  function fmt(n){return Number(n||0).toLocaleString()}
  function age(ts){
    if(!ts)return 'Never';
    const t=new Date(ts).getTime();
    if(!Number.isFinite(t))return 'Unknown';
    const mins=Math.max(0,Math.round((Date.now()-t)/60000));
    if(mins<2)return 'Just now';
    if(mins<60)return mins+'m ago';
    const hrs=Math.round(mins/60);
    if(hrs<48)return hrs+'h ago';
    return Math.round(hrs/24)+'d ago';
  }
  function laneLabel(job=''){
    return ({
      provider_resolve_episodes:'Provider title → episodes',
      provider_resolve_media:'Provider episode → media',
      resolve_episodes:'DramaBox title → episodes',
      resolve_media:'DramaBox episode → media',
      title_new:'New title',
      title_changed:'Changed title',
      episode_count_changed:'Episode count changed'
    })[job] || String(job||'Queue').replaceAll('_',' ');
  }
  function systemVisible(){
    return !!session()?.access_token
      && !$('#dashboardView')?.classList.contains('hidden')
      && document.body.dataset.workspaceView==='system';
  }
  async function rpc(){
    const s=await freshSession();
    if(!s?.access_token)throw new Error('Sign in to load sync health.');
    const res=await fetch(base+'/rest/v1/rpc/get_bingebox_workspace_sync_dashboard',{
      method:'POST',
      headers:{
        apikey:key,
        Authorization:'Bearer '+s.access_token,
        'Content-Type':'application/json'
      },
      body:'{}',
      cache:'no-store'
    });
    const text=await res.text();
    let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok)throw new Error(data?.message||data?.error||('Sync health failed ('+res.status+')'));
    return data||{};
  }
  function render(data){
    const overview=$('#syncOverviewCards'),lanesHost=$('#syncQueueLanes'),providersHost=$('#syncProviderList'),sourcesHost=$('#syncSourceProviders'),errorsHost=$('#syncRecentErrors');
    if(!overview||!lanesHost||!providersHost||!sourcesHost||!errorsHost)return;
    const q=data.queue||{},lib=data.library||{},http=data.http_recent||{};
    const providerRows=Array.isArray(data.providers)?data.providers:[];
    const laneRows=Array.isArray(data.lanes)?data.lanes:[];
    const sourceRows=Array.isArray(data.episode_source_providers)?data.episode_source_providers:[];
    const errorRows=Array.isArray(data.recent_errors)?data.recent_errors:[];
    const healthyProviders=providerRows.filter(p=>String(p.last_http_status)==='200'&&!p.cloudflare_blocked).length;
    const blockedProviders=providerRows.filter(p=>p.cloudflare_blocked).length;
    const queueActive=Number(q.pending||0)+Number(q.processing||0)+Number(q.retry_wait||0);
    const posterIssues=Number(lib.poster_issues||0);
    const backlog=Number(data.http_backlog||0);
    const card=(value,label,tone='')=>'<div class="sync-overview-card '+tone+'"><strong>'+esc(value)+'</strong><span>'+esc(label)+'</span></div>';
    overview.innerHTML=[
      card(fmt(lib.dramas),'Library titles'),
      card(fmt(lib.active_sources),'Active playable sources'),
      card(fmt(queueActive),'Jobs remaining',queueActive?'warn':'ok'),
      card(fmt(q.failed),'Failed jobs',Number(q.failed)?'bad':'ok'),
      card(fmt(posterIssues),'Poster issues',posterIssues?'bad':'ok'),
      card(fmt(backlog),'HTTP dispatch backlog',backlog>=24?'bad':backlog>=12?'warn':'ok'),
      card(healthyProviders+'/'+providerRows.length,'Providers HTTP 200',blockedProviders?'warn':'ok'),
      card(fmt(http.ok)+'/'+fmt(http.total),'10m HTTP success',Number(http.timeouts||0)||Number(http.rate_limited||0)?'warn':'ok')
    ].join('');

    const queueSummary=$('#syncQueueSummary');
    if(queueSummary)queueSummary.textContent=fmt(q.completed)+' complete · '+fmt(queueActive)+' active';
    lanesHost.innerHTML=laneRows.length?laneRows.map(x=>{
      const total=Number(x.total||0),done=Number(x.completed||0),pct=total?Math.round(done/total*100):100;
      const waiting=Number(x.pending||0)+Number(x.processing||0)+Number(x.retry_wait||0);
      return '<div class="sync-lane">'+
        '<div class="sync-lane-top"><span><strong>'+esc(laneLabel(x.job_type))+'</strong><small>'+fmt(done)+' / '+fmt(total)+' completed</small></span><b>'+pct+'%</b></div>'+
        '<div class="sync-progress"><i style="width:'+Math.max(0,Math.min(100,pct))+'%"></i></div>'+
        '<div class="sync-lane-meta"><span>'+fmt(waiting)+' remaining</span><span>'+fmt(x.failed)+' failed</span></div>'+
      '</div>';
    }).join(''):'<div class="empty">No queued sync work.</div>';

    const activeSourceTotal=sourceRows.reduce((n,x)=>n+Number(x.active||0),0);
    const sourceSummary=$('#syncSourceSummary');
    if(sourceSummary)sourceSummary.textContent=fmt(activeSourceTotal)+' active';
    sourcesHost.innerHTML=sourceRows.length?sourceRows.slice(0,14).map(x=>{
      const active=Number(x.active||0),healthy=Number(x.healthy||0),exp=Number(x.expiring_48h||0);
      return '<div class="sync-source-row"><span><strong>'+esc(x.provider||'unknown')+'</strong><small>'+fmt(healthy)+' healthy'+(exp?' · '+fmt(exp)+' expiring':'')+'</small></span><b>'+fmt(active)+'</b></div>';
    }).join(''):'<div class="empty">No episode sources yet.</div>';

    const issueScore=x=>(x.cloudflare_blocked?5:0)+(Number(x.failed)>0?4:0)+(Number(x.retry_wait)>0?3:0)+(String(x.last_http_status)!=='200'?2:0)+(Number(x.pending)>0?1:0);
    const ranked=[...providerRows].sort((a,b)=>issueScore(b)-issueScore(a)||String(a.provider||'').localeCompare(String(b.provider||'')));
    const providerSummary=$('#syncProviderSummary');
    if(providerSummary)providerSummary.textContent=providerRows.length+' enabled · '+healthyProviders+' HTTP 200 · '+blockedProviders+' blocked mirrors';
    providersHost.innerHTML=ranked.length?ranked.map(p=>{
      const failed=Number(p.failed||0),retry=Number(p.retry_wait||0),pending=Number(p.pending||0),processing=Number(p.processing||0);
      const http=String(p.last_http_status||'');
      const tone=p.cloudflare_blocked?'blocked':failed?'bad':retry?'warn':http==='200'?'ok':'idle';
      const label=p.cloudflare_blocked?'Mirror blocked':failed?'Failures':retry?'Retrying':http==='200'?'Online':Number(p.observations)?'Discovered':'Waiting';
      const queueLeft=pending+processing+retry;
      return '<article class="sync-provider-row '+tone+'">'+
        '<div class="sync-provider-name"><span class="sync-status-dot"></span><div><strong>'+esc(p.provider||p.source_key)+'</strong><small>'+esc(p.source_key)+' · '+esc(p.mode||'provider')+'</small></div></div>'+
        '<div class="sync-provider-metric"><span>Catalog</span><strong>'+fmt(p.catalog_count||p.observations)+'</strong></div>'+
        '<div class="sync-provider-metric"><span>Mapped</span><strong>'+fmt(p.mapped)+'</strong></div>'+
        '<div class="sync-provider-metric"><span>Queue</span><strong>'+fmt(queueLeft)+'</strong></div>'+
        '<div class="sync-provider-metric"><span>Done</span><strong>'+fmt(p.completed)+'</strong></div>'+
        '<div class="sync-provider-state"><b>'+esc(label)+'</b><small>'+age(p.last_successful_scan_at)+'</small></div>'+
      '</article>';
    }).join(''):'<div class="empty">No provider registry rows available.</div>';

    const errorSummary=$('#syncErrorSummary');
    if(errorSummary)errorSummary.textContent=errorRows.length?(errorRows.length+' latest shown'):'Clean';
    errorsHost.innerHTML=errorRows.length?errorRows.map(x=>
      '<div class="sync-error-row"><span><strong>'+esc(x.source_key)+'</strong><small>'+esc(laneLabel(x.job_type))+' · attempt '+Number(x.attempt_count||0)+' · '+age(x.updated_at)+'</small></span><p>'+esc(x.last_error||x.status||'Retrying')+'</p></div>'
    ).join(''):'<div class="sync-clear"><strong>✓ No queued retries or failures</strong><span>The latest queue state has no error rows.</span></div>';
  }

  async function load({quiet=false}={}){
    if(busy)return;
    const overview=$('#syncOverviewCards');
    if(!overview)return;
    busy=true;
    if(!quiet)overview.innerHTML='<div class="empty">Loading sync health…</div>';
    try{render(await rpc())}
    catch(err){if(!quiet)overview.innerHTML='<div class="empty">'+esc(err.message)+'</div>'}
    finally{busy=false}
  }
  function maybeLoad(){
    if(systemVisible())load({quiet:$('#syncProviderList')?.querySelector('.sync-provider-row')!=null}).catch(()=>{});
  }
  $('#refreshSyncCenterBtn')?.addEventListener('click',()=>load());
  window.addEventListener('hashchange',()=>setTimeout(maybeLoad,0));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)maybeLoad()});
  const observer=new MutationObserver(muts=>{
    if(muts.some(m=>m.attributeName==='data-workspace-view'||m.attributeName==='class'))maybeLoad();
  });
  observer.observe(document.body,{attributes:true,attributeFilter:['data-workspace-view','class']});
  timer=setInterval(maybeLoad,30000);
  setTimeout(maybeLoad,800);
})();
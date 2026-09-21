(() => {
  const config = window.BINGEBOX_CONFIG || {};
  // Hard fallbacks prevent this private workspace from accidentally calling Netlify's own
  // /auth/v1/* paths when a stale/missing config.js is cached.
  const base = (config.supabaseUrl || 'https://shffgnuprnycqblpwkrp.supabase.co').replace(/\/$/, '');
  const key = config.supabasePublishableKey || 'sb_publishable_PeopMn9aiDdzxqLvSkkR6w_PUw9BIJH';
  const storageKey = 'bingebox_admin_session';
  const autoR18Key = 'bingebox_auto_r18_tagging';
  let session = null;
  let dramas = [];
  let activeDrama = null;
  let heroHighlightIds=[];
  let heroAutoIds=[];
  let dramaRenderLimit=120;
  const DRAMA_RENDER_STEP=120;

  const $ = s => document.querySelector(s);
  const esc = (v='') => String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const status = (el,msg,type='') => { el.textContent=msg||''; el.className=`status ${type}`.trim(); };
  const workspaceViews={
    content:{eyebrow:'CONTENT',title:'Content Library',subtitle:'Manage titles, episodes and publishing.'},
    analytics:{eyebrow:'INSIGHTS',title:'Performance',subtitle:'Understand viewing, engagement and discovery.'},
    homepage:{eyebrow:'HOMEPAGE',title:'Homepage',subtitle:'Control the hero and featured discovery surfaces.'},
    system:{eyebrow:'SYSTEM',title:'Operations',subtitle:'Playback health, storage, notifications and moderation.'}
  };
  const workspaceLoaded=new Set();
  const workspaceLoading=new Map();
  async function loadWorkspaceViewData(view){
    if(workspaceLoaded.has(view))return;
    if(workspaceLoading.has(view))return workspaceLoading.get(view);
    const task=(async()=>{
      if(view==='content'){
        await loadDramas();
      }else if(view==='analytics'){
        await loadAnalytics();
      }else if(view==='homepage'){
        if(!dramas.length)await loadDramas();
        await loadHeroHighlightSettings();
      }else if(view==='system'){
        if(!dramas.length)await loadDramas();
        await Promise.allSettled([loadAuditLog(),checkSecureMedia(),loadContentRequests(),loadEpisodeReports(),loadDonationSettings(),loadOpsDashboard(),loadDonationTracking(),loadPushAdmin()]);
      }
      workspaceLoaded.add(view);
    })().finally(()=>workspaceLoading.delete(view));
    workspaceLoading.set(view,task);
    return task;
  }
  function setWorkspaceView(view='content',replaceHash=false){
    if(!workspaceViews[view])view='content';
    document.querySelectorAll('[data-workspace-panel]').forEach(el=>el.classList.toggle('workspace-tab-hidden',el.dataset.workspacePanel!==view));
    document.querySelectorAll('[data-workspace-nav]').forEach(a=>{const active=a.dataset.workspaceNav===view;a.classList.toggle('active',active);a.setAttribute('aria-current',active?'page':'false')});
    const meta=workspaceViews[view];
    if($('#workspaceEyebrow'))$('#workspaceEyebrow').textContent=meta.eyebrow;
    if($('#workspaceTitle'))$('#workspaceTitle').textContent=meta.title;
    if($('#workspaceSubtitle'))$('#workspaceSubtitle').textContent=meta.subtitle;
    if($('#newDramaBtn'))$('#newDramaBtn').classList.toggle('hidden',view!=='content');
    document.body.dataset.workspaceView=view;
    try{sessionStorage.setItem('bingebox_workspace_view',view)}catch{}
    if(replaceHash){const target={content:'libraryWorkspace',analytics:'analyticsWorkspace',homepage:'homepageWorkspace',system:'systemWorkspace'}[view];history.replaceState(null,'',`#${target}`)}
    window.scrollTo(0,0);
    if(session?.user&&!$('#dashboardView')?.classList.contains('hidden'))loadWorkspaceViewData(view).catch(()=>{});
  }
  function initWorkspaceNavigation(){
    const hashMap={libraryWorkspace:'content',analyticsWorkspace:'analytics',homepageWorkspace:'homepage',systemWorkspace:'system'};
    let initial=hashMap[location.hash.replace('#','')];
    if(!initial){try{initial=sessionStorage.getItem('bingebox_workspace_view')}catch{}}
    setWorkspaceView(initial||'content',false);
    document.querySelectorAll('[data-workspace-nav]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();setWorkspaceView(a.dataset.workspaceNav,true)}));
    window.addEventListener('hashchange',()=>{const next=hashMap[location.hash.replace('#','')];if(next)setWorkspaceView(next,false)});
  }
  const headers = (auth=true, json=true) => ({
    apikey:key,
    ...(auth && session?.access_token ? {Authorization:`Bearer ${session.access_token}`} : {}),
    ...(json ? {'Content-Type':'application/json'} : {})
  });

  async function api(path, options={}) {
    const res = await fetch(`${base}${path}`, {...options, headers:{...headers(options.auth!==false, options.json!==false), ...(options.headers||{})}});
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const detail = data?.msg || data?.message || data?.error_description || data?.error;
      throw new Error(detail || `Backend request failed (${res.status}) at ${path}`);
    }
    return data;
  }

  async function apiAll(path,pageSize=1000){
    const out=[];
    for(let from=0;;from+=pageSize){
      const rows=await api(path,{headers:{Range:`${from}-${from+pageSize-1}`}});
      if(!Array.isArray(rows))return rows;
      out.push(...rows);
      if(rows.length<pageSize)break;
    }
    return out;
  }

  function saveSession(s){ session=s; localStorage.setItem(storageKey, JSON.stringify(s)); }
  function clearSession(){ session=null; localStorage.removeItem(storageKey); }
  function autoR18Enabled(){
    const raw=localStorage.getItem(autoR18Key);
    return raw===null ? true : raw==='1';
  }
  function syncAutoR18Control(){
    const el=$('#autoR18Tagging');
    if(el) el.checked=autoR18Enabled();
  }
  async function refreshIfNeeded(){
    if(!session?.refresh_token) return false;
    if((session.expires_at||0)*1000 > Date.now()+60000) return true;
    try{
      const next=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',auth:false,body:JSON.stringify({refresh_token:session.refresh_token})});
      next.expires_at=Math.floor(Date.now()/1000)+(next.expires_in||3600); saveSession(next); return true;
    }catch{ clearSession(); return false; }
  }

  async function verifyAdmin(){
    await refreshIfNeeded();
    if(!session?.access_token) return false;
    try{
      const user=await api('/auth/v1/user');
      const rows=await api(`/rest/v1/admins?user_id=eq.${encodeURIComponent(user.id)}&select=user_id`);
      if(!rows?.length) throw new Error('This account is signed in but is not a BingeBox administrator.');
      session.user=user; saveSession(session); return true;
    }catch(e){ throw e; }
  }

  function showLogin(msg=''){
    $('#loginView').classList.remove('hidden'); $('#dashboardView').classList.add('hidden'); $('#logoutBtn').classList.add('hidden'); $('#sessionEmail').textContent='';
    if(msg) status($('#loginStatus'),msg,'error');
  }
  async function showDashboard(){
    $('#loginView').classList.add('hidden'); $('#dashboardView').classList.remove('hidden'); $('#logoutBtn').classList.remove('hidden'); $('#sessionEmail').textContent=session.user?.email||'';
    $('#r2Notice').classList.toggle('hidden', !!config.r2UploadEndpoint);
    syncAutoR18Control();
    initWorkspaceNavigation();
    await loadWorkspaceViewData(document.body.dataset.workspaceView||'content');
  }


  $('#loginForm').addEventListener('submit', async e=>{
    e.preventDefault(); status($('#loginStatus'),'Signing in…');
    try{
      const s=await api('/auth/v1/token?grant_type=password',{method:'POST',auth:false,body:JSON.stringify({email:$('#loginEmail').value.trim(),password:$('#loginPassword').value})});
      s.expires_at=Math.floor(Date.now()/1000)+(s.expires_in||3600); saveSession(s); await verifyAdmin(); await showDashboard();
    }catch(err){ clearSession(); status($('#loginStatus'),err.message,'error'); }
  });
  $('#logoutBtn').addEventListener('click', async()=>{ try{await api('/auth/v1/logout',{method:'POST'});}catch{} clearSession(); showLogin(); });
  $('#refreshAuditBtn')?.addEventListener('click',()=>Promise.allSettled([loadAuditLog(),checkSecureMedia()]));



  const analyticsInfo={
    about:{title:'About BingeBox analytics',body:'BingeBox analytics focuses on meaningful viewing rather than raw page hits. Metrics use the selected time window. Trending uses a rolling 72-hour score that blends qualified viewers, measured watch time, completion, My List adds, reactions, shares, growth velocity and recency. Anonymous viewers are counted with a privacy-preserving random visitor token; signed-in viewers use their account ID for de-duplication.'},
    unique:{title:'Unique viewers',body:'Distinct people who generated an analytics event in the selected period. Signed-in accounts and anonymous visitor tokens are de-duplicated so repeated refreshes do not count as new people.'},
    qualified:{title:'Qualified views',body:'A native/direct episode becomes qualified after about 30 seconds of active playback. This removes many accidental opens and instant exits. Embedded third-party players cannot always expose reliable playback timing, so they may contribute starts but not qualified views.'},
    watch:{title:'Measured watch time',body:'Active watch time measured by the BingeBox native/direct player. It is sent in small 30-second increments while playback is actually running. Cross-origin embedded players are intentionally excluded when exact playback state is unavailable.'},
    completion:{title:'Completion rate',body:'Episode completions divided by episode starts in the selected window. It shows how often a started episode reaches the end; use it together with qualified views because a start alone can be accidental.'},
    returning:{title:'Returning viewers',body:'Viewers active in this period who also had activity before the period began. It is a simple retention signal rather than a cohort-retention study.'},
    openrate:{title:'Catalog open rate',body:'Drama detail opens divided by tracked catalog-card impressions. A card impression is counted once per section when at least roughly half of the card becomes visible.'},
    errors:{title:'Playback errors',body:'Player load failures reported by the BingeBox-controlled player. A rising number can indicate an unavailable source or server and should be compared with server-switch activity.'},
    searches:{title:'Search performance',body:'Searches are tracked after a short typing pause. Zero-result searches show what viewers looked for but could not find. The Analytics panel only surfaces aggregated query counts.'},
    average:{title:'Average measured watch',body:'Measured native/direct watch time divided by qualified views in the selected window. It is useful for comparing engagement between periods, but embedded third-party players are excluded when exact playback timing is unavailable.'},
    favorites:{title:'My List adds',body:'How many times viewers added a title to My List during the selected period. It is a strong intent signal and contributes to Trending.'},
    engagement:{title:'Reactions + shares',body:'Viewer reactions and successful share actions recorded during the selected period. These are lightweight engagement signals and receive a smaller weight in Trending than actual watching.'},
    switches:{title:'Server switches',body:'How often viewers manually changed playback servers. A sudden increase can be an early signal that the default source is slow, unavailable, or producing errors.'},
    trending:{title:'Trending score',body:'A rolling engagement score rather than lifetime views. It weights qualified unique viewers (40%), measured watch minutes (25%), completion/retention (15%), My List adds (10%), reactions/shares (5%) and growth velocity (5%), with extra recency weighting. Historical watch starts are used as a small fallback while new qualified-view data accumulates.'}
  };
  function pctChange(current,previous){
    current=Number(current||0);previous=Number(previous||0);
    if(!previous)return current?null:0;
    return ((current-previous)/Math.abs(previous))*100;
  }
  function analyticsCard(value,label,key,change=null){
    const delta=change==null?'':`<small class="metric-change ${change>0?'up':change<0?'down':'flat'}">${change>0?'↑':change<0?'↓':'→'} ${Math.abs(change).toFixed(1)}%</small>`;
    return `<button class="analytics-card" type="button" data-metric-card="${key}"><span>${esc(label)}</span><strong>${value}</strong>${delta}<i class="analytics-info-btn" data-analytics-info="${key}" aria-label="About ${esc(label)}">i</i></button>`
  }
  function fmtDuration(seconds){seconds=Number(seconds||0);if(seconds<60)return `${Math.round(seconds)}s`;const m=Math.round(seconds/60);return m<60?`${m}m`:`${Math.floor(m/60)}h ${m%60}m`}
  function chartRows(rows=[],opts={}){
    const list=(Array.isArray(rows)?rows:[]).map(x=>({label:String(x.label||'Unknown'),value:Math.max(0,Number(x.value||0)),note:x.note?String(x.note):''}));
    const max=Math.max(1,...list.map(x=>x.value));
    return list.length?`<div class="analytics-rank-list">${list.map((x,i)=>`<div class="analytics-rank-row"><b>${String(i+1).padStart(2,'0')}</b><div><span>${esc(x.label)}</span>${x.note?`<small>${esc(x.note)}</small>`:''}</div><strong>${opts.format?opts.format(x.value):x.value.toLocaleString()}</strong><i aria-hidden="true" style="--w:${Math.max(x.value>0?3:0,Math.min(100,(x.value/max)*100))}%"></i></div>`).join('')}</div>`:'<div class="empty compact">No data yet.</div>';
  }
  function miniRows(title,rows=[]){return `<section class="analytics-mix-section"><span class="analytics-mini-title">${esc(title)}</span>${chartRows(rows)}</section>`}
  function metaLineChart(rows=[],key='viewers',title='Views'){
    const data=Array.isArray(rows)?rows:[];
    if(!data.length)return '<div class="empty compact">No trend data yet.</div>';
    const W=900,H=260,pad={l:42,r:18,t:22,b:36};const vals=data.map(r=>Math.max(0,Number(r[key]||0)));const max=Math.max(1,...vals);
    const x=i=>pad.l+(data.length<=1?0:(i/(data.length-1))*(W-pad.l-pad.r));const y=v=>pad.t+(1-(Math.max(0,Number(v||0))/max))*(H-pad.t-pad.b);
    const d=data.map((r,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ');
    const area=`${d} L${x(data.length-1).toFixed(1)},${H-pad.b} L${x(0).toFixed(1)},${H-pad.b} Z`;
    const grid=[0,.25,.5,.75,1].map(v=>{const yy=pad.t+v*(H-pad.t-pad.b),label=Math.round(max*(1-v));return `<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}" class="analytics-gridline"></line><text x="${pad.l-8}" y="${yy+3}" text-anchor="end" class="analytics-axis-label">${label.toLocaleString()}</text>`}).join('');
    const labels=data.length>4?[0,Math.floor((data.length-1)/2),data.length-1]:data.map((_,i)=>i);
    return `<svg class="analytics-line-svg meta-line-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} over time">${grid}<path class="meta-area" d="${area}"></path><path class="analytics-line" d="${d}"></path>${data.map((r,i)=>`<circle class="analytics-dot" cx="${x(i)}" cy="${y(r[key])}" r="3"><title>${esc(r.day_label||'')} · ${Number(r[key]||0).toLocaleString()} ${esc(title.toLowerCase())}</title></circle>`).join('')}${labels.map(i=>`<text x="${x(i)}" y="${H-10}" text-anchor="${i===0?'start':i===data.length-1?'end':'middle'}" class="analytics-axis-label">${esc(data[i]?.day_label||'')}</text>`).join('')}</svg>`;
  }
  let analyticsGraphMetric='viewers',analyticsDaily=[];
  const graphMetrics={viewers:'Viewers',starts:'Episode starts',qualified:'Qualified views',watch_minutes:'Watch minutes',completions:'Completions'};
  function renderAnalyticsGraph(){
    const box=$('#analyticsTrends'),title=$('#analyticsGraphTitle'),tabs=$('#analyticsMetricTabs');if(!box)return;
    if(title)title.textContent=graphMetrics[analyticsGraphMetric]||'Performance';
    if(tabs)tabs.innerHTML=Object.entries(graphMetrics).map(([k,v])=>`<button type="button" class="metric-tab ${k===analyticsGraphMetric?'active':''}" data-graph-metric="${k}">${esc(v)}</button>`).join('');
    box.innerHTML=metaLineChart(analyticsDaily,analyticsGraphMetric,graphMetrics[analyticsGraphMetric]);
  }
  async function loadAnalytics(){
    const cards=$('#analyticsCards'),trends=$('#analyticsTrends'),top=$('#analyticsTop'),funnel=$('#analyticsFunnel'),breakdown=$('#analyticsBreakdown');if(!cards||!top)return;
    cards.innerHTML='<div class="empty">Loading insights…</div>';if(trends)trends.innerHTML='';top.innerHTML='';if(funnel)funnel.innerHTML='';if(breakdown)breakdown.innerHTML='';
    try{
      const days=Math.max(1,Number($('#analyticsDays')?.value||30));
      const [data,extended]=await Promise.all([
        api('/rest/v1/rpc/get_bingebox_analytics',{method:'POST',body:JSON.stringify({p_days:days})}),
        api('/rest/v1/rpc/get_bingebox_analytics',{method:'POST',body:JSON.stringify({p_days:Math.min(180,days*2)})}).catch(()=>null)
      ]);
      const prev=(name)=>Math.max(0,Number(extended?.[name]||0)-Number(data?.[name]||0));
      const daily=Array.isArray(data?.daily_series)?data.daily_series:[];analyticsDaily=daily;
      const note=$('#analyticsPeriodNote');if(note)note.textContent=`Last ${days} days · compared with the preceding ${days} days where the metric is additive`;
      cards.innerHTML=[
        analyticsCard(Number(data?.unique_visitors||0).toLocaleString(),'Viewers','unique',null),
        analyticsCard(Number(data?.qualified_views||0).toLocaleString(),'Qualified views','qualified',pctChange(data?.qualified_views,prev('qualified_views'))),
        analyticsCard(fmtDuration(data?.measured_watch_seconds||0),'Watch time','watch',pctChange(data?.measured_watch_seconds,prev('measured_watch_seconds'))),
        analyticsCard(`${Number(data?.completion_rate||0).toFixed(1)}%`,'Completion rate','completion',null)
      ].join('');
      renderAnalyticsGraph();
      const f=data?.funnel||{},steps=[['Impressions',f.impressions],['Opens',f.opens],['Starts',f.starts],['Qualified',f.qualified],['Completed',f.completions]];
      if(funnel){const funnelRows=steps.map(([label,value],i)=>{const n=Number(value||0),prevStep=i?Number(steps[i-1][1]||0):0;return{label,value:n,note:i&&prevStep?`${Math.min(100,(n/prevStep)*100).toFixed(1)}% from ${String(steps[i-1][0]).toLowerCase()}`:'Discovery'} });funnel.innerHTML=`<div class="analytics-subhead"><div><span>VIEWING FUNNEL</span><strong>How viewers move from discovery to completion</strong></div><button class="analytics-info-btn" type="button" data-analytics-info="qualified">i</button></div>${chartRows(funnelRows)}`;}
      const rows=Array.isArray(data?.top_dramas)?data.top_dramas:[];
      const titleRows=rows.slice(0,10).map(r=>({label:r.title||'Untitled',value:Number(r.qualified||0),note:`${Number(r.watch_minutes||0)} min watched · ${Number(r.completion_rate||0)}% completed`}));
      top.innerHTML=`<div class="analytics-subhead"><div><span>TOP CONTENT</span><strong>Best-performing titles</strong></div></div>${chartRows(titleRows)}`;
      if(breakdown){const searches=(data?.top_searches||[]).map(x=>({label:x.label,value:x.value,note:Number(x.zero||0)?`${Number(x.zero)} zero-result`:''}));breakdown.innerHTML=miniRows('Viewer type',data?.viewer_type_split)+miniRows('Devices',data?.device_split)+miniRows('Top genres',data?.top_genres)+miniRows('Searches',searches)+`<details class="analytics-more-breakdown"><summary>More audience details</summary>${miniRows('Browsers',data?.browser_split)+miniRows('Operating systems',data?.os_split)+miniRows('Languages',data?.language_split)+miniRows('Referrers',data?.referrer_split)+miniRows('Playback quality',[{label:'Server switches',value:Number(data?.server_switches||0)},{label:'Playback errors',value:Number(data?.playback_errors||0)}])}</details>`;}
    }catch(err){cards.innerHTML=`<div class="empty">${esc(err.message)}</div>`}
  }
  $('#refreshAnalyticsBtn')?.addEventListener('click',loadAnalytics);
  $('#analyticsDays')?.addEventListener('change',loadAnalytics);
  $('#analyticsMetricTabs')?.addEventListener('click',e=>{const b=e.target.closest('[data-graph-metric]');if(!b)return;analyticsGraphMetric=b.dataset.graphMetric;renderAnalyticsGraph()});
  $('#analyticsCards')?.addEventListener('click',e=>{const b=e.target.closest('[data-metric-card]');if(!b)return;const map={unique:'viewers',qualified:'qualified',watch:'watch_minutes',completion:'completions'};analyticsGraphMetric=map[b.dataset.metricCard]||analyticsGraphMetric;renderAnalyticsGraph()});
  document.addEventListener('click',e=>{const b=e.target.closest('[data-analytics-info]');if(!b)return;const info=analyticsInfo[b.dataset.analyticsInfo]||analyticsInfo.about;$('#analyticsInfoTitle').textContent=info.title;$('#analyticsInfoBody').innerHTML=`<p>${esc(info.body)}</p>`;$('#analyticsInfoDialog')?.showModal()});
  $('#closeAnalyticsInfo')?.addEventListener('click',()=>$('#analyticsInfoDialog')?.close());

  function heroPublishedDramas(){
    const now=Date.now();
    return dramas.filter(d=>d.published && !(d.publish_at&&new Date(d.publish_at).getTime()>now));
  }
  function heroOptionMarkup(selected=''){
    const items=heroPublishedDramas();
    return `<option value="">Choose a published drama</option>`+items
      .slice().sort((a,b)=>String(a.title||'').localeCompare(String(b.title||'')))
      .map(d=>`<option value="${esc(d.id)}" ${String(d.id)===String(selected)?'selected':''}>${esc(d.title)}</option>`).join('');
  }
  function renderHeroHighlightManager(){
    const manual=heroHighlightIds.length>0;
    const mode=$('#heroManualMode'),fields=$('#heroManualFields'),auto=$('#heroAutoPreview');
    if(!mode||!fields||!auto)return;
    mode.checked=manual;
    fields.classList.toggle('hidden',!manual);
    const picks=[heroHighlightIds[0]||'',heroHighlightIds[1]||'',heroHighlightIds[2]||''];
    ['heroPick1','heroPick2','heroPick3'].forEach((id,i)=>{const el=$('#'+id);if(el)el.innerHTML=heroOptionMarkup(picks[i])});
    const byId=new Map(dramas.map(d=>[String(d.id),d]));
    const autoRows=heroAutoIds.map(id=>byId.get(String(id))).filter(Boolean);
    auto.innerHTML=autoRows.length
      ? `<span>AUTO · TOP 3 TRENDING</span>${autoRows.map((d,i)=>`<b><i>#${i+1}</i>${esc(d.title)}</b>`).join('')}`
      : '<span>AUTO · TOP 3 TRENDING</span><b>Trending data will populate as viewers watch.</b>';
    status($('#heroHighlightStatus'),manual?'Custom picks are active.':'Automatic Top 3 Trending is active.','');
  }
  async function loadHeroHighlightSettings(){
    try{
      const [settings,trending]=await Promise.all([
        api('/rest/v1/site_settings?key=eq.hero_highlight_ids&select=key,value'),
        api('/rest/v1/rpc/get_bingebox_trending',{method:'POST',body:JSON.stringify({p_hours:72,p_limit:3})}).catch(()=>[])
      ]);
      heroHighlightIds=[];
      try{
        const parsed=JSON.parse(settings?.[0]?.value||'[]');
        if(Array.isArray(parsed))heroHighlightIds=parsed.map(String).filter(Boolean).slice(0,3);
      }catch{}
      heroAutoIds=(Array.isArray(trending)?trending:[]).map(r=>String(r.drama_id||'')).filter(Boolean).slice(0,3);
      if(heroAutoIds.length<3){
        const used=new Set(heroAutoIds);
        heroPublishedDramas().forEach(d=>{if(heroAutoIds.length<3&&!used.has(String(d.id))){heroAutoIds.push(String(d.id));used.add(String(d.id))}});
      }
      renderHeroHighlightManager();
      renderDramas(dramaEpisodeCounts);
    }catch(err){
      status($('#heroHighlightStatus'),err.message,'error');
    }
  }
  $('#heroManualMode')?.addEventListener('change',e=>{
    const fields=$('#heroManualFields');
    fields?.classList.toggle('hidden',!e.target.checked);
    if(e.target.checked && !heroHighlightIds.length){
      const seed=heroAutoIds.slice(0,3);
      ['heroPick1','heroPick2','heroPick3'].forEach((id,i)=>{const el=$('#'+id);if(el)el.innerHTML=heroOptionMarkup(seed[i]||'')});
    }
    status($('#heroHighlightStatus'),e.target.checked?'Choose three published dramas, then save.':'Top 3 Trending will be restored when you save.','');
  });
  $('#saveHeroHighlightsBtn')?.addEventListener('click',async()=>{
    const st=$('#heroHighlightStatus'),manual=!!$('#heroManualMode')?.checked;
    try{
      let ids=[];
      if(manual){
        ids=['#heroPick1','#heroPick2','#heroPick3'].map(sel=>$(sel)?.value||'');
        if(ids.some(id=>!id))throw new Error('Choose all three highlight slots.');
        if(new Set(ids).size!==3)throw new Error('Each highlight slot must use a different drama.');
      }
      status(st,'Saving…');
      await api('/rest/v1/site_settings',{
        method:'POST',
        headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify([{key:'hero_highlight_ids',value:JSON.stringify(ids),updated_by:session.user?.id||null}])
      });
      heroHighlightIds=ids;
      renderHeroHighlightManager();
      renderDramas(dramaEpisodeCounts);
      status(st,ids.length?'Custom homepage highlights saved.':'Automatic Top 3 Trending restored.','success');
    }catch(err){status(st,err.message,'error')}
  });


  async function loadDonationSettings(){
    const url=$('#donationUrl'),label=$('#donationLabel'),st=$('#donationSettingsStatus');if(!url||!label)return;
    try{const rows=await api('/rest/v1/site_settings?key=in.(donate_url,donate_label)&select=key,value');const map=Object.fromEntries((rows||[]).map(r=>[r.key,r.value]));url.value=map.donate_url||'';label.value=map.donate_label||'Donate';status(st,'')}
    catch(err){status(st,err.message,'error')}
  }
  $('#saveDonationSettingsBtn')?.addEventListener('click',async()=>{
    const st=$('#donationSettingsStatus'),raw=$('#donationUrl').value.trim(),label=($('#donationLabel').value.trim()||'Donate').slice(0,28);status(st,'Saving…');
    try{if(raw){const u=new URL(raw);if(u.protocol!=='https:')throw new Error('Use an HTTPS donation URL.')}const rows=[{key:'donate_url',value:raw,updated_by:session.user?.id||null},{key:'donate_label',value:label,updated_by:session.user?.id||null}];await api('/rest/v1/site_settings',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows)});status(st,raw?'Donation button is live.':'Saved. The Donate button will show an unconfigured message until a URL is added.','ok')}
    catch(err){status(st,err.message,'error')}
  });

  async function loadContentRequests(){
    const host=$('#adminRequestList'); if(!host) return;
    try{const rows=await api('/rest/v1/content_requests?select=id,title,note,status,votes,created_at&order=votes.desc,created_at.asc&limit=50');host.innerHTML=rows.length?rows.map(r=>`<article class="mod-row"><div><strong>${esc(r.title)}</strong><span>${r.votes} vote${r.votes===1?'':'s'} · ${esc(r.status)}${r.note?` · ${esc(r.note)}`:''}</span></div><div class="mod-actions"><button class="ghost-btn" data-request-status="planned" data-request-id="${r.id}">Planned</button><button class="ghost-btn" data-request-status="uploaded" data-request-id="${r.id}">Uploaded</button><button class="danger-btn" data-request-status="closed" data-request-id="${r.id}">Close</button></div></article>`).join(''):'<div class="empty">No community requests yet.</div>'}catch(err){host.innerHTML=`<div class="empty">${esc(err.message)}</div>`}
  }
  async function loadEpisodeReports(){
    const host=$('#adminReportList'); if(!host) return;
    try{const rows=await api('/rest/v1/episode_reports?select=id,drama_title,episode_number,reason,details,contact_email,status,created_at&status=in.(open,reviewing)&order=created_at.desc&limit=50');host.innerHTML=rows.length?rows.map(r=>`<article class="mod-row report-row"><div><strong>${esc(r.drama_title)} · EP ${r.episode_number}</strong><span>${esc(r.reason.replaceAll('_',' '))} · ${new Date(r.created_at).toLocaleString()}</span>${r.details?`<p>${esc(r.details)}</p>`:''}${r.contact_email?`<small>${esc(r.contact_email)}</small>`:''}</div><div class="mod-actions"><button class="ghost-btn" data-report-status="reviewing" data-report-id="${r.id}">Reviewing</button><button class="ghost-btn" data-report-status="resolved" data-report-id="${r.id}">Resolve</button><button class="danger-btn" data-report-status="dismissed" data-report-id="${r.id}">Dismiss</button></div></article>`).join(''):'<div class="empty">No open episode reports.</div>'}catch(err){host.innerHTML=`<div class="empty">${esc(err.message)}</div>`}
  }
  $('#refreshRequestsBtn')?.addEventListener('click',loadContentRequests);
  $('#refreshReportsBtn')?.addEventListener('click',loadEpisodeReports);


  const functionsBase=`${base}/functions/v1`;
  const workerBase=(config.r2UploadEndpoint||'https://bingebox-upload.hero-tolentino.workers.dev').replace(/\/$/,'');
  const fmtBytes=n=>{n=Number(n||0);if(n<1024)return `${n} B`;const units=['KB','MB','GB','TB'];let i=-1;do{n/=1024;i++}while(n>=1024&&i<units.length-1);return `${n.toFixed(n>=100?0:n>=10?1:2)} ${units[i]}`};
  const fmtPhp=c=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:2}).format(Number(c||0)/100);
  async function functionApi(slug,query='',options={}){
    const res=await fetch(`${functionsBase}/${slug}${query}`,{...options,headers:{apikey:key,...(session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{ }),'Content-Type':'application/json',...(options.headers||{})},cache:'no-store'});
    const text=await res.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={error:text}}if(!res.ok)throw new Error(data?.error||data?.message||`${slug} failed (${res.status})`);return data;
  }
  async function loadStorageUsage(){
    const fill=$('#storageMeterFill'),label=$('#storageMeterLabel');
    const res=await fetch(`${workerBase}/admin/storage`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data?.error||`Storage check failed (${res.status})`);
    const gb=Number(data.totalBytes||0)/1e9,pct=Math.min(100,gb/Number(data.freeTierGb||10)*100);if(fill)fill.style.width=`${pct}%`;if(label)label.textContent=`${gb.toFixed(gb<1?2:1)} / ${data.freeTierGb||10} GB`;
    $('#storageVideoObjects').textContent=Number(data.videoObjects||0).toLocaleString();$('#storageAverageVideo').textContent=fmtBytes(data.averageVideoBytes||0);$('#storageOrphans').textContent=`${Number(data.orphanVideoObjects||0)} · ${fmtBytes(data.orphanVideoBytes||0)}`;$('#storageCost').textContent=`$${Number(data.estimatedMonthlyStorageUsd||0).toFixed(2)}/mo`;
    try{await api('/rest/v1/storage_usage_snapshots',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({total_bytes:data.totalBytes||0,video_bytes:data.videoBytes||0,poster_bytes:data.posterBytes||0,other_bytes:data.otherBytes||0,total_objects:data.totalObjects||0,video_objects:data.videoObjects||0,poster_objects:data.posterObjects||0,orphan_video_objects:data.orphanVideoObjects||0,orphan_video_bytes:data.orphanVideoBytes||0,measured_by:session.user.id})})}catch{}
    return data;
  }
  function sourceExpiryMs(raw=''){
    const m=String(raw||'').match(/[?&]auth_key=(\d+)-/);
    return m?Number(m[1])*1000:null;
  }
  async function loadSourceHealth(){
    const cards=$('#sourceHealthCards'),attention=$('#sourceHealthAttention');
    if(!cards||!attention)return;
    cards.dataset.loaded='1';
    cards.innerHTML='<div class="empty">Checking episode source coverage…</div>';
    attention.innerHTML='';
    try{
      const d=await api('/rest/v1/rpc/get_bingebox_workspace_source_health',{method:'POST',body:'{}'});
      const pct=Number(d?.coverage_pct||0);
      const missing=Number(d?.missing||0),disabled=Number(d?.disabled_only||0),expired=Number(d?.expired_only||0);
      const needs=Number(d?.needs_source||missing+disabled+expired),multi=Number(d?.multi_server||0);
      const errors=Number(d?.playback_errors_7d||0),src=d?.sources||{};
      const expiredSources=Number(src.expired_active_sources||0),expiring=Number(src.expiring_sources||0);
      const card=(value,label,tone='')=>`<div class="source-health-card ${tone}"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;
      cards.innerHTML=[
        card(`${pct.toFixed(1)}%`,'Usable coverage',pct>=98?'ok':pct>=90?'warn':'bad'),
        card(String(needs),'Needs source',needs?'bad':'ok'),
        card(String(expiredSources),'Expired active',expiredSources?'bad':'ok'),
        card(String(expiring),'Expiring <48h',expiring?'warn':'ok'),
        card(String(multi),'With fallback',''),
        card(String(errors),'7d playback errors',errors?'warn':'ok')
      ].join('');

      const issues=Array.isArray(d?.issues)?d.issues:[];
      if(needs){
        const stateLabel={expired:'SIGNED SOURCE EXPIRED',missing:'NO ACTIVE SOURCE',disabled:'ALL SOURCES DISABLED'};
        const stateTone={expired:'bad',missing:'bad',disabled:'warn'};
        attention.innerHTML=`<div class="source-health-subhead"><span>NEEDS ATTENTION</span><strong>${needs} published episode${needs===1?'':'s'}</strong></div>`+
          issues.map(x=>`<div class="source-health-row"><span><strong>${esc(x.drama_title||'Unknown title')}</strong><small>EP ${String(x.episode_number||0).padStart(2,'0')} · ${esc(x.title||`Episode ${x.episode_number||0}`)}</small></span><b class="${stateTone[x.state]||'warn'}">${esc(stateLabel[x.state]||String(x.state||'NEEDS SOURCE').toUpperCase())}</b></div>`).join('')+
          (needs>issues.length?`<div class="source-health-more">+ ${needs-issues.length} more in the episode manager</div>`:'');
      }else{
        attention.innerHTML='<div class="source-health-clear"><strong>✓ Source coverage is clean</strong><span>Every published episode has at least one usable configured source.</span></div>';
      }
    }catch(err){
      cards.innerHTML=`<div class="empty">${esc(err.message)}</div>`;
      attention.innerHTML='';
    }
  }

  async function fixBrokenEpisodes(){
    const btn=$('#fixBrokenEpisodesBtn'),st=$('#sourceRepairStatus');
    if(!btn||!st)return;
    const label=btn.textContent;
    btn.disabled=true;btn.textContent='Fixing broken episodes…';
    status(st,'Retesting disabled stored sources and restoring every reusable broken episode…');
    try{
      const data=await functionApi('source-repair','?action=fix-broken',{method:'POST',body:JSON.stringify({})});
      const broken=Number(data.broken_episodes||0);
      const repaired=Number(data.repaired_episodes||0);
      const reactivated=Number(data.reactivated_sources||0);
      const unresolved=Number(data.unresolved_episodes||0);
      const errors=Number(data.update_errors||0);
      const deepScanned=Number(data.deep_scanned_active_sources||0);
      const deadDisabled=Number(data.active_dead_disabled||0);
      const inconclusive=Number(data.probe_inconclusive||0);
      const parts=[`${broken} broken found`];
      if(deepScanned)parts.push(`${deepScanned} active source${deepScanned===1?'':'s'} tested`);
      if(deadDisabled)parts.push(`${deadDisabled} dead active source${deadDisabled===1?'':'s'} disabled`);
      parts.push(`${repaired} episode${repaired===1?'':'s'} repaired`,`${reactivated} source${reactivated===1?'':'s'} reactivated`);
      if(Number(data.unsigned_recovered||0))parts.push(`${Number(data.unsigned_recovered)} expired token${Number(data.unsigned_recovered)===1?'':'s'} recovered`);
      if(inconclusive)parts.push(`${inconclusive} probe${inconclusive===1?'':'s'} inconclusive`);
      if(unresolved)parts.push(`${unresolved} still need fresh capture`);
      if(errors)parts.push(`${errors} backend update error${errors===1?'':'s'}`);
      status(st,`Broken-episode repair complete · ${parts.join(' · ')}.`,unresolved||errors?'error':'success');
      await Promise.allSettled([loadSourceHealth(),loadDramas()]);
      if(activeDrama&&currentEpisodes?.length)await loadEpisodes().catch(()=>{});
    }catch(err){status(st,err.message,'error')}
    finally{btn.disabled=false;btn.textContent=label;}
  }

  async function fixAllSources(){
    const btn=$('#fixAllSourcesBtn'),st=$('#sourceRepairStatus');
    if(!btn||!st)return;
    const label=btn.textContent;
    btn.disabled=true;btn.textContent='Fixing sources…';
    status(st,'Scanning every external source and repairing backend routing…');
    try{
      const data=await functionApi('source-repair','?action=fix-all',{method:'POST',body:JSON.stringify({})});
      const repaired=Number(data.routes_fixed||0)+Number(data.fallbacks_synced||0)+Number(data.unsigned_recovered||0)+Number(data.expired_disabled||0);
      const unresolved=Number(data.unresolved_episodes||0);
      const parts=[`${Number(data.scanned_sources||0)} scanned`,`${repaired} repair action${repaired===1?'':'s'}`];
      if(Number(data.expired_disabled||0))parts.push(`${Number(data.expired_disabled)} expired disabled`);
      if(Number(data.unsigned_recovered||0))parts.push(`${Number(data.unsigned_recovered)} recovered without token`);
      if(Number(data.expiring_within_48h||0))parts.push(`${Number(data.expiring_within_48h)} expiring soon`);
      if(unresolved)parts.push(`${unresolved} need fresh import`);
      if(Number(data.update_errors||0))parts.push(`${Number(data.update_errors)} backend update error${Number(data.update_errors)===1?'':'s'}`);
      status(st,`Fix complete · ${parts.join(' · ')}.`,unresolved?'error':'success');
      await Promise.allSettled([loadSourceHealth(),loadDramas()]);
      if(activeDrama&&currentEpisodes?.length)await loadEpisodes().catch(()=>{});
    }catch(err){status(st,err.message,'error')}
    finally{btn.disabled=false;btn.textContent=label;}
  }

  async function loadOpsDashboard(){
    const cards=$('#opsCards'),checks=$('#opsCheckList');if(!cards||!checks)return;cards.innerHTML='<div class="empty">Running production checks…</div>';checks.innerHTML='';
    const results=[];let storage=null;
    try{storage=await loadStorageUsage();results.push(['R2 storage','Connected','ok'])}catch(err){results.push(['R2 storage',err.message,'bad'])}
    try{const res=await fetch(`${workerBase}/token?health=1`,{cache:'no-store'});const data=await res.json();if(!res.ok||!data.ready)throw new Error('Secure media gateway unavailable');results.push(['Secure playback','Ready','ok'])}catch(err){results.push(['Secure playback',err.message,'bad'])}
    try{const d=await functionApi('push-api','?action=config');results.push(['Push service',d.enabled?'Ready':'Unavailable',d.enabled?'ok':'bad'])}catch(err){results.push(['Push service',err.message,'bad'])}
    try{const d=await functionApi('paymongo-webhook');results.push(['Donation webhook',d.configured?'Configured':'Needs PayMongo webhook secret',d.configured?'ok':'warn'])}catch(err){results.push(['Donation webhook',err.message,'warn'])}
    try{const reg=await navigator.serviceWorker?.getRegistration?.('/');results.push(['PWA service worker',reg?'Active':'Not active in this browser',reg?'ok':'warn'])}catch{results.push(['PWA service worker','Unable to verify','warn'])}
    const used=storage?fmtBytes(storage.totalBytes):'—',orphans=storage?Number(storage.orphanVideoObjects||0):0;
    cards.innerHTML=`<div class="ops-card"><span>R2 stored</span><strong>${used}</strong></div><div class="ops-card"><span>Objects</span><strong>${storage?Number(storage.totalObjects||0).toLocaleString():'—'}</strong></div><div class="ops-card"><span>Orphan files</span><strong class="${orphans?'warn':'ok'}">${storage?orphans:'—'}</strong></div><div class="ops-card"><span>Free tier left</span><strong>${storage?`${Number(storage.freeTierRemainingGb||0).toFixed(2)} GB`:'—'}</strong></div>`;
    checks.innerHTML=results.map(r=>`<div class="ops-check"><span>${esc(r[0])}</span><strong class="${r[2]}">${esc(r[1])}</strong></div>`).join('');
    const sourceCards=$('#sourceHealthCards');
    if(sourceCards&&!sourceCards.dataset.loaded)sourceCards.innerHTML='<div class="empty">Source inventory is loaded only on demand to reduce Supabase egress. Tap “Refresh sources” when you need a full scan.</div>';
  }
  $('#runOpsChecksBtn')?.addEventListener('click',loadOpsDashboard);
  $('#refreshSourceHealthBtn')?.addEventListener('click',loadSourceHealth);
  $('#fixBrokenEpisodesBtn')?.addEventListener('click',fixBrokenEpisodes);
  $('#fixAllSourcesBtn')?.addEventListener('click',fixAllSources);

  async function loadDonationTracking(){
    if(!$('#donationTotal'))return;
    try{
      const [summary,rows,hook]=await Promise.all([api('/rest/v1/rpc/get_ops_summary',{method:'POST',body:JSON.stringify({p_days:30})}),api('/rest/v1/donation_events?select=event_id,amount_centavos,currency,payment_method,paid_at,created_at&livemode=eq.true&order=paid_at.desc.nullslast,created_at.desc&limit=12'),functionApi('paymongo-webhook')]);
      $('#donationTotal').textContent=fmtPhp(summary?.donation_amount_centavos);$('#donationCount').textContent=Number(summary?.donation_count||0).toLocaleString();$('#donationAllTime').textContent=fmtPhp(summary?.donation_all_time_centavos);
      const state=$('#donationWebhookState');state.className=`integration-state ${hook.configured?'ok':'warn'}`;state.textContent=hook.configured?'Webhook signature verification is configured.':`Tracking needs one PayMongo webhook setup. Endpoint: ${hook.endpoint}`;
      $('#recentDonations').innerHTML=rows.length?rows.map(r=>`<div class="compact-row"><div><strong>${esc((r.payment_method||'payment').replaceAll('_',' '))}</strong><span>${new Date(r.paid_at||r.created_at).toLocaleString()}</span></div><strong>${fmtPhp(r.amount_centavos)}</strong></div>`).join(''):'<div class="empty">No tracked live payments yet.</div>';
    }catch(err){$('#donationWebhookState').className='integration-state warn';$('#donationWebhookState').textContent=err.message}
  }
  $('#refreshDonationsBtn')?.addEventListener('click',loadDonationTracking);

  async function loadPushAdmin(){
    if(!$('#pushSubscriberCount'))return;
    try{const d=await functionApi('push-api','?action=status');$('#pushSubscriberCount').textContent=Number(d.subscriberCount||0).toLocaleString();const rows=Array.isArray(d.history)?d.history:[];$('#pushHistory').innerHTML=rows.length?rows.map(r=>`<div class="compact-row"><div><strong>${esc(r.title)}</strong><span>${new Date(r.sent_at).toLocaleString()} · ${r.delivered}/${r.attempted} delivered</span></div><strong>${r.failed?`${r.failed} failed`:'✓'}</strong></div>`).join(''):'<div class="empty">No notifications sent yet.</div>'}catch(err){$('#pushHistory').innerHTML=`<div class="empty">${esc(err.message)}</div>`}
  }
  $('#refreshPushBtn')?.addEventListener('click',loadPushAdmin);
  $('#pushBroadcastForm')?.addEventListener('submit',async e=>{
    e.preventDefault();const st=$('#pushBroadcastStatus');status(st,'Sending…');
    try{let url=$('#pushUrlInput').value.trim()||'/';if(!url.startsWith('/'))throw new Error('Notification destination must be a BingeBox path beginning with /.');const d=await functionApi('push-api','?action=send',{method:'POST',body:JSON.stringify({action:'send',title:$('#pushTitleInput').value.trim(),body:$('#pushBodyInput').value.trim(),url})});status(st,`Sent to ${d.delivered} device${d.delivered===1?'':'s'}${d.failed?` · ${d.failed} failed`:''}.`,'success');await loadPushAdmin()}catch(err){status(st,err.message,'error')}
  });

  async function maybeSendCompletedDramaPush(drama){
    if(!drama?.id||!drama.published||!drama.is_complete||drama.completion_push_sent_at||(drama.publish_at&&new Date(drama.publish_at)>new Date()))return {sent:false,skipped:true};

    // Atomically claim this title before broadcasting. This prevents duplicate pushes
    // from double-clicks, two Workspace tabs, or a save racing with another save.
    const claimedAt=new Date().toISOString();
    const claimed=await api(`/rest/v1/dramas?id=eq.${encodeURIComponent(drama.id)}&completion_push_sent_at=is.null&select=id`,{
      method:'PATCH',
      headers:{Prefer:'return=representation'},
      body:JSON.stringify({completion_push_sent_at:claimedAt})
    });
    if(!claimed?.length)return {sent:false,skipped:true};

    const slug=encodeURIComponent(drama.slug||'');
    const title=`Complete series: ${drama.title}`;
    const body='Every published episode is now available. Start watching on BingeBox.';
    const url=`/?drama=${slug}`;

    try{
      const result=await functionApi('push-api','?action=send',{
        method:'POST',
        body:JSON.stringify({action:'send',title,body,url,tag:`complete-${drama.id}`})
      });
      return {
        sent:true,
        delivered:Number(result?.delivered||0),
        failed:Number(result?.failed||0),
        sentAt:claimedAt
      };
    }catch(err){
      // A fetch/network failure is ambiguous: the server may already have delivered the
      // push, so keep the one-time claim to prevent an accidental duplicate blast.
      if(err instanceof TypeError){
        err.notificationDeliveryUnknown=true;
        throw err;
      }
      // A definite HTTP/API failure means the push did not complete normally. Release
      // the claim so a later save can retry automatically.
      try{
        await api(`/rest/v1/dramas?id=eq.${encodeURIComponent(drama.id)}&completion_push_sent_at=eq.${encodeURIComponent(claimedAt)}`,{
          method:'PATCH',
          headers:{Prefer:'return=minimal'},
          body:JSON.stringify({completion_push_sent_at:null})
        });
        err.notificationRetryable=true;
      }catch{}
      throw err;
    }
  }

  async function loadDramas(){
    try{
      const dramaRows=await apiAll('/rest/v1/dramas?select=*,episode_stats:episodes(count)&order=sort_order.asc,created_at.desc',1000);
      dramas=Array.isArray(dramaRows)?dramaRows:[];
      dramaRenderLimit=DRAMA_RENDER_STEP;
      const counts={};
      for(const d of dramas)counts[d.id]=Math.max(0,Number(d.episode_stats?.[0]?.count||0));
      dramaEpisodeCounts=counts;
      renderStats(counts);renderDramas(counts);
    }catch(err){ $('#dramaList').innerHTML=`<div class="empty">${esc(err.message)}</div>`; }
  }
  function renderStats(counts){
    const total=dramas.length, live=dramas.filter(d=>d.published).length, episodes=Object.values(counts).reduce((a,b)=>a+b,0);
    $('#stats').innerHTML=`<div class="stat"><strong>${total}</strong><span>Dramas</span></div><div class="stat"><strong>${episodes}</strong><span>Episodes</span></div><div class="stat"><strong>${live}</strong><span>Published</span></div>`;
  }
  function auditLabel(action=''){
    return ({drama_published:'Drama published',drama_unpublished:'Drama taken offline',episode_published:'Episode published',episode_unpublished:'Episode unpublished'})[action] || action.replaceAll('_',' ');
  }
  function auditDetail(row){
    const d=row.details||{};
    if(row.entity_type==='episodes') return `Episode ${d.episode_number||'—'}${d.title?` · ${esc(d.title)}`:''}`;
    if(row.entity_type==='dramas') return esc(d.title||'Drama');
    return row.entity_type||'record';
  }
  async function loadAuditLog(){
    const host=$('#auditList'); if(!host) return;
    try{
      const rows=await api('/rest/v1/publication_audit_log?select=id,occurred_at,action,entity_type,details&order=occurred_at.desc&limit=12');
      host.innerHTML=rows?.length?rows.map(r=>`<div class="audit-row"><div><strong>${esc(auditLabel(r.action))}</strong><span>${auditDetail(r)}</span></div><time datetime="${esc(r.occurred_at)}">${new Date(r.occurred_at).toLocaleString()}</time></div>`).join(''):'<div class="empty">No publication changes recorded yet.</div>';
    }catch(err){host.innerHTML=`<div class="empty">${esc(err.message)}</div>`}
  }
  async function checkSecureMedia(){
    const el=$('#secureMediaStatus'); if(!el) return;
    try{
      const endpoint=config.secureMediaEndpoint||''; if(!endpoint) throw new Error('missing endpoint'); const res=await fetch(`${endpoint}?health=1`,{cache:'no-store',headers:{Accept:'application/json'}});
      const data=await res.json().catch(()=>({}));
      if(res.ok&&data.ready){el.textContent='Ready';el.className='ok'}else{el.textContent='Needs setup';el.className='warn'}
    }catch{el.textContent='Needs setup';el.className='warn'}
  }
  function localDateTimeValue(value){
    if(!value)return '';
    const d=new Date(value); if(Number.isNaN(d.getTime()))return '';
    const off=d.getTimezoneOffset(); return new Date(d.getTime()-off*60000).toISOString().slice(0,16);
  }
  function isoOrNull(value){ return value ? new Date(value).toISOString() : null; }
  let dramaEpisodeCounts={};
  function dramaViewRows(){
    const q=($('#dramaSearch')?.value||'').trim().toLowerCase();
    const filter=$('#dramaStatusFilter')?.value||'all';
    const sort=$('#dramaSort')?.value||'updated';
    const now=Date.now();
    let rows=dramas.filter(d=>{
      const scheduled=!!(d.published&&d.publish_at&&new Date(d.publish_at).getTime()>now);
      const state=scheduled?'scheduled':d.published?'published':'draft';
      const matchesFilter=filter==='all'||filter===state||(filter==='complete'&&d.is_complete)||(filter==='r18'&&d.is_r18);
      const hay=[d.title,d.genre,d.slug,d.description].filter(Boolean).join(' ').toLowerCase();
      return matchesFilter&&(!q||hay.includes(q));
    });
    rows.sort((a,b)=>{
      if(sort==='title')return String(a.title||'').localeCompare(String(b.title||''));
      if(sort==='episodes')return Number(dramaEpisodeCounts[b.id]||0)-Number(dramaEpisodeCounts[a.id]||0);
      if(sort==='status')return Number(!!b.published)-Number(!!a.published)||String(a.title||'').localeCompare(String(b.title||''));
      return new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0);
    });
    return rows;
  }
  function renderDramas(counts=dramaEpisodeCounts){
    dramaEpisodeCounts=counts||{};
    const rows=dramaViewRows(),visible=rows.slice(0,dramaRenderLimit);
    const total=dramas.length,published=dramas.filter(d=>d.published&&!(d.publish_at&&new Date(d.publish_at)>new Date())).length,drafts=dramas.filter(d=>!d.published).length;
    const summary=$('#librarySummary');if(summary)summary.textContent=`${rows.length} matched · ${Math.min(visible.length,rows.length)} rendered · ${total} total · ${published} published · ${drafts} drafts`;
    const heroIds=heroHighlightIds.length?heroHighlightIds:heroAutoIds;
    $('#dramaList').innerHTML=visible.length?visible.map(d=>{
      const scheduled=!!(d.published&&d.publish_at&&new Date(d.publish_at)>new Date());
      const state=scheduled?`Scheduled ${new Date(d.publish_at).toLocaleDateString()}`:d.published?'Published':'Draft';
      const description=String(d.description||'').trim();
      const heroSlot=heroIds.indexOf(String(d.id));
      return `<article class="drama-row ${heroSlot>=0?'is-hero-pick':''}">
        <img src="${esc(d.poster_url||'/assets/brand/mark.svg')}" alt="" loading="lazy">
        <div class="drama-main">
          <div class="drama-title-line"><h3>${esc(d.title)}</h3><span class="library-ep-count">${counts[d.id]||0} EP</span></div>
          ${description?`<p class="drama-row-description">${esc(description)}</p>`:''}
          <div class="drama-meta"><span class="genre-chip">${esc(d.genre)}</span><span class="badge ${d.published?'live':''}">${esc(state)}</span>${d.is_complete?'<span class="badge complete">Complete</span>':''}${d.is_r18?'<span class="badge r18">R18</span>':''}${heroSlot>=0?`<span class="badge hero-slot">H${heroSlot+1}</span>`:''}</div>
        </div>
        <div class="row-actions"><button class="ghost-btn" data-episodes="${d.id}">Episodes</button><button class="primary-btn compact-action" data-edit="${d.id}">Edit</button></div>
      </article>`;
    }).join(''):'<div class="empty library-empty">No dramas match this view.</div>';
    const more=$('#loadMoreDramasBtn');
    if(more){
      const remaining=Math.max(0,rows.length-visible.length);
      more.classList.toggle('hidden',remaining===0);
      more.textContent=remaining?('Load '+Math.min(DRAMA_RENDER_STEP,remaining)+' more · '+remaining.toLocaleString()+' remaining'):'Load more';
    }
  }
  ['dramaSearch','dramaStatusFilter','dramaSort'].forEach(id=>$('#'+id)?.addEventListener(id==='dramaSearch'?'input':'change',()=>{dramaRenderLimit=DRAMA_RENDER_STEP;renderDramas(dramaEpisodeCounts)}));
  $('#loadMoreDramasBtn')?.addEventListener('click',()=>{dramaRenderLimit+=DRAMA_RENDER_STEP;renderDramas(dramaEpisodeCounts)});

  const dlg=$('#dramaDialog');
  function slugify(s){return s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)}
  let r18ManualTouched=false;
  function detectR18Metadata({title='',description='',genre='',mood=[]}={}){
    const text=[title,description,genre,Array.isArray(mood)?mood.join(' '):mood]
      .join(' ').toLowerCase().replace(/[–—]/g,'-');

    const rules=[
      [/\br[\s-]?18\b/g,12,'R18 rating'],
      [/\b18\s*\+\b/g,12,'18+ rating'],
      [/\badult[-\s]?only\b/g,12,'adult-only rating'],
      [/\bnc[-\s]?17\b/g,11,'NC-17 rating'],
      [/\btv[-\s]?ma\b/g,10,'TV-MA rating'],
      [/\bxxx\b|\bnsfw\b/g,10,'explicit adult label'],
      [/\bporn(?:ography|ographic)?\b|\bsexually explicit\b/g,10,'explicit sexual content'],
      [/\bgraphic sex(?:ual)?\b|\bexplicit sex(?:ual)?\b/g,10,'explicit sexual content'],
      [/\bnudity\b|\bfull nudity\b|\bnude scenes?\b/g,8,'nudity'],
      [/\berotic(?:a)?\b|\berotic scenes?\b/g,7,'erotic content'],
      [/\bsexual content\b|\bsexual situations?\b/g,7,'sexual-content warning'],
      [/\bstripper\b|\bescort\b|\bprostitut(?:e|ion)\b|\bbrothel\b/g,6,'adult-content theme'],
      [/\buncensored\b/g,5,'uncensored wording'],
      [/\bbed scenes?\b|\bintimate scenes?\b|\bsteamy scenes?\b/g,3,'intimate-scene wording'],
      [/\bsensual\b|\bseductive\b|\bsteamy\b/g,2,'suggestive wording'],
      [/\bmature themes?\b|\bmature content\b/g,2,'mature-content wording'],
      [/\bpg[-\s]?13\b|\btv[-\s]?pg\b|\btv[-\s]?14\b/g,-7,'non-adult rating'],
      [/\b13\s*\+\b|\b14\s*\+\b|\b15\s*\+\b|\b16\s*\+\b/g,-5,'under-18 rating']
    ];

    let score=0;
    const reasons=[];
    for(const [rx,w,label] of rules){
      const hits=text.match(rx)?.length||0;
      if(!hits) continue;
      score += Math.min(2,hits)*w;
      if(w>0) reasons.push(label);
    }

    if(/\badult (?:man|woman|male|female|character|characters|life|relationship|relationships)\b/.test(text)
       && !/\badult[-\s]?only\b|\b18\s*\+\b|\br[\s-]?18\b|\bsexual\b|\berotic\b|\bnudity\b/.test(text)){
      score-=3;
    }

    const likely=score>=7;
    const confidence=score>=12?'high':score>=7?'medium':score>=3?'low':'none';
    return {likely,score,confidence,reasons:[...new Set(reasons)].slice(0,4)};
  }
  function currentR18Scan(){
    return detectR18Metadata({
      title:$('#title')?.value||'',
      description:$('#description')?.value||'',
      genre:$('#genre')?.value||'',
      mood:($('#mood')?.value||'').split(',').map(x=>x.trim()).filter(Boolean)
    });
  }
  function renderR18Scan({apply=false,force=false}={}){
    const result=currentR18Scan(),row=$('#r18DetectorRow'),statusEl=$('#r18DetectorStatus'),flag=$('#r18Flag');
    if(!statusEl||!flag)return result;
    row?.classList.toggle('likely',result.likely);
    statusEl.textContent=result.likely
      ? `R18 detector: ${result.confidence} confidence${result.reasons.length?` · ${result.reasons.join(' · ')}`:''}.`
      : result.score>=3
        ? 'R18 detector: weak adult-content signal — not auto-tagged.'
        : 'R18 detector: no reliable 18+ signal detected.';
    if(apply && autoR18Enabled() && (!r18ManualTouched || force)){
      flag.checked=!!result.likely;
    }
    return result;
  }

  function openEditor(d=null){
    activeDrama=d; $('#editorTitle').textContent=d?'Edit drama':'Add drama'; $('#dramaId').value=d?.id||''; $('#title').value=d?.title||''; $('#slug').value=d?.slug||''; $('#genre').value=d?.genre||'romance'; $('#sortOrder').value=d?.sort_order||0; $('#dramaPublishAt').value=localDateTimeValue(d?.publish_at); $('#mood').value=(d?.mood||[]).join(', '); $('#description').value=d?.description||''; $('#posterUrl').value=d?.poster_url||''; $('#featured').checked=!!d?.featured; $('#completeSeries').checked=!!d?.is_complete; $('#r18Flag').checked=!!d?.is_r18; $('#published').checked=!!d?.published; r18ManualTouched=false; $('#deleteDramaBtn').classList.toggle('hidden',!d); $('#takeOfflineBtn').classList.toggle('hidden',!d); $('#posterFile').value=''; $('#posterUploadStatus').textContent=''; const pp=$('#posterPreview'); if(d?.poster_url){pp.src=d.poster_url;pp.classList.remove('hidden')}else{pp.removeAttribute('src');pp.classList.add('hidden')} status($('#editorStatus'),''); dlg.showModal(); setTimeout(()=>{syncAutoR18Control();renderR18Scan({apply:true});},0);
  }
  $('#newDramaBtn').addEventListener('click',()=>openEditor());
  $('#title').addEventListener('input',()=>{if(!activeDrama) $('#slug').value=slugify($('#title').value)});
  $('#r18Flag')?.addEventListener('change',()=>{r18ManualTouched=true;renderR18Scan()});
  $('#autoR18Tagging')?.addEventListener('change',e=>{
    localStorage.setItem(autoR18Key,e.target.checked?'1':'0');
    if(e.target.checked){
      r18ManualTouched=false;
      renderR18Scan({apply:true,force:true});
    }else renderR18Scan();
  });
  $('#scanR18Btn')?.addEventListener('click',()=>{
    r18ManualTouched=false;
    renderR18Scan({apply:true,force:true});
  });
  ['#title','#description','#genre','#mood'].forEach(sel=>$(sel)?.addEventListener('input',()=>renderR18Scan({apply:true})));
  $('#genre')?.addEventListener('change',()=>renderR18Scan({apply:true}));
  $('#closeEditor').addEventListener('click',()=>dlg.close()); $('#cancelDramaBtn').addEventListener('click',()=>dlg.close());
  document.addEventListener('click',e=>{const ed=e.target.closest('[data-edit]');if(ed)openEditor(dramas.find(d=>d.id===ed.dataset.edit)); const ep=e.target.closest('[data-episodes]');if(ep)openEpisodes(dramas.find(d=>d.id===ep.dataset.episodes));});

  $('#dramaForm').addEventListener('submit',async e=>{
    e.preventDefault();status($('#editorStatus'),'Saving…');
    const requestedPublish=$('#published').checked;
    if(autoR18Enabled()&&!r18ManualTouched) renderR18Scan({apply:true});
    const body={
      slug:slugify($('#slug').value),
      title:$('#title').value.trim(),
      genre:$('#genre').value,
      mood:$('#mood').value.split(',').map(x=>x.trim()).filter(Boolean),
      description:$('#description').value.trim(),
      poster_url:$('#posterUrl').value.trim()||null,
      featured:$('#featured').checked,
      is_complete:$('#completeSeries').checked,
      is_r18:$('#r18Flag').checked,
      published:requestedPublish,
      publish_at:isoOrNull($('#dramaPublishAt').value),
      sort_order:Number($('#sortOrder').value)||0
    };
    try{
      let savedDrama=null;
      if(activeDrama){
        const updated=await api(`/rest/v1/dramas?id=eq.${activeDrama.id}&select=*`,{
          method:'PATCH',
          headers:{Prefer:'return=representation'},
          body:JSON.stringify(body)
        });
        savedDrama=updated?.[0]||{...activeDrama,...body};
      }else{
        const created=await api('/rest/v1/dramas?select=*',{
          method:'POST',
          headers:{Prefer:'return=representation'},
          body:JSON.stringify({...body,published:false})
        });
        const d=created?.[0];
        if(!d?.id)throw new Error('Drama was created but its ID was not returned.');
        if(requestedPublish){
          const publishedRows=await api(`/rest/v1/dramas?id=eq.${d.id}&select=*`,{
            method:'PATCH',
            headers:{Prefer:'return=representation'},
            body:JSON.stringify({published:true,publish_at:null})
          });
          savedDrama=publishedRows?.[0]||{...d,published:true,publish_at:null};
        }else savedDrama=d;
      }

      let pushNote='';
      if(savedDrama?.published&&savedDrama?.is_complete&&!savedDrama?.completion_push_sent_at&&(!savedDrama.publish_at||new Date(savedDrama.publish_at)<=new Date())){
        try{
          status($('#editorStatus'),'Published. Sending complete-series notification…');
          const push=await maybeSendCompletedDramaPush(savedDrama);
          if(push.sent)pushNote=` Auto notification sent to ${push.delivered} device${push.delivered===1?'':'s'}${push.failed?` · ${push.failed} failed`:''}.`;
        }catch(pushErr){
          pushNote=pushErr.notificationDeliveryUnknown
            ? ` Published. The notification connection ended before delivery could be confirmed, so BingeBox will not auto-resend it and risk a duplicate.`
            : ` Published, but the automatic notification could not be sent (${pushErr.message}).${pushErr.notificationRetryable?' It will retry the next time this title is saved while still complete and published.':''}`;
        }
      }

      status(
        $('#editorStatus'),
        `${savedDrama?.published?'Saved and published.':'Saved as draft.'}${pushNote}`,
        pushNote.includes('could not be sent')?'error':'success'
      );
      await loadDramas();await loadAuditLog();if(pushNote&&!pushNote.includes('could not be sent'))await loadPushAdmin();
      setTimeout(()=>dlg.close(),pushNote.includes('could not be sent')?1500:650);
    }catch(err){status($('#editorStatus'),err.message,'error')}
  });
  $('#deleteDramaBtn').addEventListener('click',async()=>{if(!activeDrama||!confirm(`Delete “${activeDrama.title}” and all its episodes?`))return;try{await api(`/rest/v1/dramas?id=eq.${activeDrama.id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});dlg.close();await loadDramas()}catch(err){status($('#editorStatus'),err.message,'error')}});
  $('#takeOfflineBtn').addEventListener('click',async()=>{if(!activeDrama||!confirm(`Take “${activeDrama.title}” and all of its episodes offline now?`))return;try{status($('#editorStatus'),'Taking title offline…');await api(`/rest/v1/episodes?drama_id=eq.${activeDrama.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({published:false})});await api(`/rest/v1/dramas?id=eq.${activeDrama.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({published:false})});$('#published').checked=false;status($('#editorStatus'),'Title and episodes are offline.','success');await loadDramas();await loadAuditLog()}catch(err){status($('#editorStatus'),err.message,'error')}});

  function uploadR2(file, kind, extra={}, onProgress=()=>{}){
    return new Promise((resolve,reject)=>{
      if(!config.r2UploadEndpoint) return reject(new Error('Cloudflare R2 is not connected yet.'));
      const limit=kind==='video'?1024*1024*1024:15*1024*1024;
      if(file.size>limit) return reject(new Error(kind==='video'?'Video exceeds the 1 GB upload limit.':'Poster exceeds the 15 MB upload limit.'));
      const q=new URLSearchParams({kind,filename:file.name,...extra});
      const xhr=new XMLHttpRequest();
      xhr.open('PUT',`${config.r2UploadEndpoint}?${q}`);
      xhr.setRequestHeader('Authorization',`Bearer ${session.access_token}`);
      xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
      xhr.upload.onprogress=e=>{ if(e.lengthComputable) onProgress(Math.round((e.loaded/e.total)*100)); };
      xhr.onload=()=>{let data={};try{data=JSON.parse(xhr.responseText||'{}')}catch{} if(xhr.status>=200&&xhr.status<300)resolve(data);else reject(new Error(data.error||`Upload failed (${xhr.status})`));};
      xhr.onerror=()=>reject(new Error('Upload connection failed. Check your connection and try again.'));
      xhr.send(file);
    });
  }
  $('#posterFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;$('#posterUploadStatus').textContent='Uploading 0%…';try{const out=await uploadR2(file,'poster',{dramaId:activeDrama?.id||'new'},pct=>$('#posterUploadStatus').textContent=`Uploading ${pct}%…`);$('#posterUrl').value=out.url;const pp=$('#posterPreview');pp.src=out.url;pp.classList.remove('hidden');$('#posterUploadStatus').textContent='Uploaded. Click Save drama to keep it.'}catch(err){$('#posterUploadStatus').textContent=err.message}});
  $('#posterUrl').addEventListener('input',()=>{const pp=$('#posterPreview');const u=$('#posterUrl').value.trim();if(u){pp.src=u;pp.classList.remove('hidden')}else{pp.removeAttribute('src');pp.classList.add('hidden')}});

  const epDlg=$('#episodesDialog');
  let currentEpisodes=[];
  let episodeSourcesByEpisode=new Map();
  let editingSourceId=null;
  let editingSourceEpisodeId=null;
  let bulkItems=[];
  let bulkUploading=false;
  const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  const maxVideoBytes=1024*1024*1024;

  function humanSize(bytes=0){
    if(bytes<1024) return `${bytes} B`;
    const units=['KB','MB','GB','TB']; let n=bytes/1024, i=0;
    while(n>=1024&&i<units.length-1){n/=1024;i++}
    return `${n>=10?n.toFixed(1):n.toFixed(2)} ${units[i]}`;
  }
  function nextEpisodeNumber(){return (currentEpisodes.at(-1)?.episode_number||0)+1}
  function setEpisodeMode(mode){
    const bulk=mode==='bulk';
    $('#singleEpisodePanel').classList.toggle('hidden',bulk);
    $('#bulkEpisodePanel').classList.toggle('hidden',!bulk);
    $('#singleModeBtn').classList.toggle('active',!bulk);
    $('#bulkModeBtn').classList.toggle('active',bulk);
    $('#singleModeBtn').setAttribute('aria-selected',String(!bulk));
    $('#bulkModeBtn').setAttribute('aria-selected',String(bulk));
  }

  async function openEpisodes(d){
    activeDrama=d;
    $('#episodesTitle').textContent=d.title;
    $('#episodeNumber').value=1;
    $('#episodeTitle').value='';
    $('#episodeFile').value='';
    $('#episodeProvider').value='upnshare';
    $('#episodeServerLabel').value='Server 1';
    $('#episodeSourceType').value='embed';
    $('#episodeSourceUrl').value='';
    editingSourceId=null; editingSourceEpisodeId=null;
    $('#addEpisodeBtn').textContent='Add source';
    status($('#episodeStatus'),'');
    resetBulkQueue();
    setEpisodeMode('single');
    $('#bulkPublish').checked=false; $('#bulkPublish').disabled=false; if($('#bulkSchedule')){$('#bulkSchedule').checked=false;$('#bulkScheduleFields')?.classList.add('hidden')} if($('#selectAllEpisodes'))$('#selectAllEpisodes').checked=false; if($('#episodeBulkStatus'))status($('#episodeBulkStatus'),'');
    epDlg.showModal();
    await loadEpisodes();
  }
  $('#closeEpisodes').addEventListener('click',()=>{
    if(bulkUploading) return status($('#bulkStatus'),'Uploads are still running. Keep this window open until the batch finishes.','error');
    epDlg.close();
  });
  epDlg.addEventListener('cancel',e=>{if(bulkUploading){e.preventDefault();status($('#bulkStatus'),'Uploads are still running. Keep this window open until the batch finishes.','error')}});
  $('#singleModeBtn').addEventListener('click',()=>setEpisodeMode('single'));
  $('#bulkModeBtn').addEventListener('click',()=>setEpisodeMode('bulk'));

  async function loadEpisodes(){
    try{
      currentEpisodes=await api(`/rest/v1/episodes?drama_id=eq.${activeDrama.id}&select=*&order=episode_number.asc`);
      episodeSourcesByEpisode=new Map();
      const ids=currentEpisodes.map(e=>e.id);
      if(ids.length){
        const rows=await api(`/rest/v1/episode_sources?episode_id=in.(${ids.join(',')})&select=id,episode_id,provider,server_label,source_type,source_url,priority,active&order=priority.asc`);
        (rows||[]).forEach(src=>{const list=episodeSourcesByEpisode.get(src.episode_id)||[];list.push(src);episodeSourcesByEpisode.set(src.episode_id,list)});
      }
      const next=nextEpisodeNumber();
      $('#episodeNumber').value=next;
      if(!bulkItems.length) $('#bulkStartNumber').value=next;
      renderEpisodes();
      if(bulkItems.length) assignBulkNumbers();
    }catch(err){status($('#episodeStatus'),err.message,'error')}
  }
  function renderEpisodes(){
    $('#episodeCountLabel').textContent=`${currentEpisodes.length} total`;
    const drafts=currentEpisodes.filter(e=>!e.published).length; const allBtn=$('#publishAllDraftsBtn'); if(allBtn){allBtn.disabled=!drafts;allBtn.textContent=drafts?`Publish all drafts (${drafts})`:'All episodes published';}
    $('#episodeList').innerHTML=currentEpisodes.length?currentEpisodes.map(e=>{
      const future=e.published&&e.publish_at&&new Date(e.publish_at)>new Date();
      const state=future?`Scheduled · ${new Date(e.publish_at).toLocaleString()}`:e.published?'Published':'Draft';
      const sources=episodeSourcesByEpisode.get(e.id)||[];
      const chips=sources.length?`<div class="episode-source-chips">${sources.map((src,i)=>`<span class="episode-source-chip ${src.active?'':'is-off'}"><b>${esc(src.server_label||`Server ${src.priority}`)}</b>${esc(src.provider)} · ${esc(src.source_type)}${src.active?'':' · OFF'}<span class="source-chip-actions"><button type="button" data-move-source="up" data-source-id="${src.id}" data-episode-id="${e.id}" ${i===0?'disabled':''} title="Move up" aria-label="Move source up">↑</button><button type="button" data-move-source="down" data-source-id="${src.id}" data-episode-id="${e.id}" ${i===sources.length-1?'disabled':''} title="Move down" aria-label="Move source down">↓</button><button type="button" data-toggle-source="${src.id}" title="${src.active?'Disable':'Enable'} source" aria-label="${src.active?'Disable':'Enable'} ${esc(src.server_label)}">${src.active?'●':'○'}</button><button type="button" data-edit-source="${src.id}" data-episode-number="${e.episode_number}" title="Edit source" aria-label="Edit ${esc(src.server_label)}">✎</button><button type="button" data-delete-source="${src.id}" title="Remove source" aria-label="Remove ${esc(src.server_label)}">×</button></span></span>`).join('')}</div>`:'<div class="episode-source-chips"><span class="episode-source-chip">No player source</span></div>';
      return `<div class="episode-row"><label class="episode-select"><input type="checkbox" data-episode-select="${e.id}" aria-label="Select episode ${e.episode_number}"></label><div class="episode-num">${String(e.episode_number).padStart(2,'0')}</div><div><h4>${esc(e.title||`Episode ${e.episode_number}`)}</h4><p>${sources.length} source${sources.length===1?'':'s'} · ${esc(state)}</p>${chips}</div><div class="row-actions"><button class="ghost-btn" data-add-source="${e.episode_number}" type="button">+ Source</button><button class="ghost-btn" data-toggle-episode="${e.id}" data-live="${e.published}">${e.published?'Unpublish':'Publish'}</button><button class="danger-btn" data-delete-episode="${e.id}">Delete</button></div></div>`;
    }).join(''):'<div class="empty">No episodes yet.</div>';
    syncEpisodeSelectionUI();
  }

  $('#addEpisodeBtn').addEventListener('click',async()=>{
    const raw=$('#episodeSourceUrl').value.trim();
    if(!raw)return status($('#episodeStatus'),'Paste an external player URL first.','error');
    let parsed; try{parsed=new URL(raw)}catch{return status($('#episodeStatus'),'Enter a valid HTTPS URL.','error')}
    if(parsed.protocol!=='https:')return status($('#episodeStatus'),'Use an HTTPS player URL.','error');
    status($('#episodeStatus'),'Saving source…');
    try{
      await refreshIfNeeded();
      const num=Math.max(1,Number($('#episodeNumber').value)||1);
      let ep=editingSourceEpisodeId?currentEpisodes.find(e=>e.id===editingSourceEpisodeId):currentEpisodes.find(e=>Number(e.episode_number)===num);
      let created=false;
      if(!ep){
        const rows=await api('/rest/v1/episodes?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({drama_id:activeDrama.id,episode_number:num,title:$('#episodeTitle').value.trim(),video_key:null,video_url:null,published:false})});
        ep=rows?.[0]; created=true;
        if(!ep?.id)throw new Error('Episode was created but its ID was not returned.');
      }
      const existing=episodeSourcesByEpisode.get(ep.id)||[];
      const priority=(existing.reduce((m,x)=>Math.max(m,Number(x.priority)||0),0)||0)+1;
      const label=($('#episodeServerLabel').value.trim()||`Server ${priority}`).slice(0,60);
      const provider=($('#episodeProvider').value.trim()||'external').toLowerCase().slice(0,60);
      if(editingSourceId){
        await api(`/rest/v1/episode_sources?id=eq.${editingSourceId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({provider,server_label:label,source_type:$('#episodeSourceType').value,source_url:parsed.href})});
        status($('#episodeStatus'),'Player source updated.','success');
      }else{
        await api('/rest/v1/episode_sources',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({episode_id:ep.id,provider,server_label:label,source_type:$('#episodeSourceType').value,source_url:parsed.href,priority,active:true})});
        status($('#episodeStatus'),created?'Episode created as a draft with its first external source.':'Backup source added to the existing episode.','success');
      }
      editingSourceId=null; editingSourceEpisodeId=null; $('#addEpisodeBtn').textContent='Add source'; $('#episodeNumber').readOnly=false;
      $('#episodeSourceUrl').value=''; $('#episodeTitle').value='';
      await loadEpisodes();await loadDramas();
    }catch(err){status($('#episodeStatus'),err.message,'error')}
  });


  function inferSourceMeta(rawUrl){
    let u; try{u=new URL(rawUrl)}catch{return {valid:false,reason:'Invalid URL.'}}
    if(u.protocol!=='https:')return {valid:false,reason:'Only HTTPS player URLs are allowed.'};
    const host=u.hostname.toLowerCase(), path=(u.pathname||'').toLowerCase(), search=(u.search||'').toLowerCase();
    const direct=/\.(mp4|webm|m3u8|mov)(?:$|\?)/i.test(u.href);
    const obviousPage=/(^|\/)(watch|series|drama|episode|episodes)(\/|$)/i.test(path) || /(?:^|[?&])page=watch(?:&|$)/i.test(search);
    const explicitEmbed=/\/(?:embed|player|videoembed|e)\b/i.test(path) || /(?:^|[?&])(embed|player)=/i.test(search);
    const knownEmbedHost=/(^|\.)upnshare\.com$|(^|\.)upn\.one$|(^|\.)ok\.ru$|(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)vimeo\.com$/i.test(host);
    if(obviousPage && !explicitEmbed && !direct)return {valid:false,reason:'This looks like a webpage/watch-page URL, not an embeddable player URL.'};
    const provider=host.includes('upnshare')||host.endsWith('.upn.one')?'upnshare':host.includes('ok.ru')?'okru':host.includes('youtube')||host==='youtu.be'?'youtube':host.includes('vimeo')?'vimeo':'external';
    return {valid:true,url:u.href,provider,source_type:direct?'direct':'embed'};
  }

  const importerBase=(config.importerEndpoint||config.r2UploadEndpoint||'').replace(/\/$/,'');
  let quickImportItems=[];
  let quickImportFailures=[];

  function setImporterHealth(state,title,detail=''){
    const box=$('#importerHealth');if(!box)return;
    box.dataset.state=state||'idle';
    $('#importerHealthTitle').textContent=title||'Importer status';
    $('#importerHealthDetail').textContent=detail||'';
  }
  function importerError(err,stage='request'){
    if(err?.name==='AbortError')return new Error(`Importer ${stage} timed out. The Worker did not respond in time.`);
    if(err instanceof TypeError||/failed to fetch|networkerror|load failed/i.test(String(err?.message||'')))return new Error('Browser could not reach the importer Worker. Check this deployment\'s CSP, Worker CORS, custom domain, or network connection.');
    return err instanceof Error?err:new Error(String(err||'Unknown importer error.'));
  }
  async function testImporterConnection(showStatus=true){
    if(!importerBase){setImporterHealth('error','Importer not configured','No importerEndpoint is present in config.js.');return null}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    if(showStatus)setImporterHealth('warn','Testing importer…','Checking browser → Worker connectivity and Worker configuration.');
    try{
      const res=await fetch(`${importerBase}/`,{method:'GET',headers:{Accept:'application/json'},cache:'no-store',signal:controller.signal});
      const text=await res.text();let data={};try{data=text?JSON.parse(text):{}}catch{}
      if(!res.ok)throw new Error(data.error||`Worker health check returned HTTP ${res.status}.`);
      if(!data?.ok)throw new Error('Worker health response was invalid.');
      const configured=data.supabase_url!==false&&data.supabase_key!==false;
      setImporterHealth(configured?'ok':'warn',configured?'Importer connected':'Importer connected · configuration warning',`Worker ${data.version||'unknown'} · Supabase URL ${data.supabase_url===false?'missing':'ready'} · key ${data.supabase_key===false?'missing':'ready'}`);
      return data;
    }catch(raw){const err=importerError(raw,'health check');setImporterHealth('error','Importer connection failed',err.message);if(showStatus)status($('#seriesImportStatus'),err.message,'error');return null}
    finally{clearTimeout(timer)}
  }
  $('#importerHealthTest')?.addEventListener('click',async()=>{const b=$('#importerHealthTest');b.disabled=true;await testImporterConnection(true);b.disabled=false});

  async function fetchSeriesImport(url,retryEpisodes=[]){
    let u;try{u=new URL(url)}catch{throw new Error('Paste a valid watch or series URL.')}
    if(u.protocol!=='https:')throw new Error('Use an HTTPS watch/series URL.');
    if(!importerBase)throw new Error('The server-side importer is not configured.');
    await refreshIfNeeded();
    if(!session?.access_token)throw new Error('Your admin session expired. Sign in again.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),70000);
    try{
      const res=await fetch(`${importerBase}/admin/import-series`,{
        method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({url:u.href,...(retryEpisodes.length?{retry_episodes:retryEpisodes}: {})}),cache:'no-store',signal:controller.signal
      });
      const text=await res.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={error:text||'Importer returned a non-JSON response.'}}
      if(!res.ok){
        const layer=res.status===401?'Supabase admin authorization':res.status===403?'Worker origin authorization':res.status>=500?'Worker/server':'Importer request';
        throw new Error(`${layer} failed (${res.status}): ${data.error||res.statusText||'Unknown error.'}`);
      }
      if(!Array.isArray(data.items))throw new Error('Importer returned an invalid response: items[] is missing.');
      return data;
    }catch(raw){throw importerError(raw,'request')}finally{clearTimeout(timer)}
  }
  function normalizeImportedItems(items){
    const seen=new Set(),out=[],rejected=[];let duplicates=0;
    for(const x of items||[]){
      const meta=inferSourceMeta(x.url||'');
      if(!meta.valid){rejected.push({episode_number:Number(x.episode_number)||0,url:x.url||'',reason:meta.reason});continue}
      const n=Number(x.episode_number)||0;if(n<1){rejected.push({episode_number:0,url:meta.url,reason:'Missing episode number.'});continue}
      const k=`${n}|${meta.url}`;if(seen.has(k)){duplicates++;continue}seen.add(k);
      out.push({episode_number:n,url:meta.url,provider:x.provider||meta.provider,source_type:x.source_type||meta.source_type,validation:'valid'});
    }
    return {items:out.sort((a,b)=>a.episode_number-b.episode_number),rejected,duplicates};
  }
  function renderImportDiagnostics(result,normalized){
    const box=$('#seriesImportDiagnostics');if(!box)return;
    const failures=Array.isArray(result?.failures)?result.failures:[];
    const discovered=Number(result?.episodes_discovered||0),checked=Number(result?.episodes_checked||0),found=normalized.items.length,rejected=normalized.rejected.length,dupes=normalized.duplicates||0;
    box.classList.remove('hidden');
    box.innerHTML=`<div class="import-diagnostic"><strong>${discovered}</strong><span>Episodes found</span></div><div class="import-diagnostic"><strong>${checked}</strong><span>Pages checked</span></div><div class="import-diagnostic ${found?'':'is-warn'}"><strong>${found}</strong><span>Valid sources</span></div><div class="import-diagnostic ${failures.length?'is-error':''}"><strong>${failures.length}</strong><span>Failed episodes</span></div>${(rejected||dupes)?`<div class="import-failure-list"><strong>Validation:</strong> ${rejected} rejected URL${rejected===1?'':'s'} · ${dupes} duplicate${dupes===1?'':'s'} skipped before saving.</div>`:''}${failures.length?`<div class="import-failure-list"><strong>Failed:</strong> ${failures.slice(0,8).map(f=>`Ep ${Number(f.episode_number)||'?'} — ${escapeHtml(f.error||'Fetch failed')}`).join(' · ')}${failures.length>8?' · …':''}</div>`:''}`;
  }
  function renderQuickImportPreview(items,rejected=[]){
    const box=$('#quickImportPreview');if(!box)return;
    const rows=[...items.map(x=>`<div class="quick-import-item import-valid"><strong class="quick-import-item-head">Episode ${x.episode_number}<span class="import-source-state valid">READY</span></strong><span class="source-url">${escapeHtml(x.url)}</span><small>${escapeHtml(x.provider||'external')} · ${escapeHtml(x.source_type||'embed')} · URL structure valid</small></div>`),...rejected.map(x=>`<div class="quick-import-item import-rejected"><strong class="quick-import-item-head">${x.episode_number?`Episode ${x.episode_number}`:'Skipped'}<span class="import-source-state rejected">REJECTED</span></strong><span class="source-url">${escapeHtml(x.url||'Unknown URL')}</span><small>${escapeHtml(x.reason||'Invalid source')}</small></div>`)];
    box.innerHTML=rows.join('')||'<div class="empty">No player sources were returned.</div>';
  }
  async function executeAutomaticImport(retryOnly=false){
    const raw=$('#seriesImportUrl')?.value.trim();if(!raw)return status($('#seriesImportStatus'),'Paste a watch or series URL first.','error');
    const btn=retryOnly?$('#seriesImportRetry'):$('#seriesImportFetch');if(btn)btn.disabled=true;
    if(!retryOnly){quickImportItems=[];quickImportFailures=[];$('#seriesImportDiagnostics')?.classList.add('hidden');$('#seriesImportRetry')?.classList.add('hidden')}
    status($('#seriesImportStatus'),retryOnly?'Retrying failed episode pages…':'Discovering episodes and player sources…');
    try{
      if(!retryOnly&&$('#importerHealth')?.dataset.state!=='ok')await testImporterConnection(false);
      const result=await fetchSeriesImport(raw,retryOnly?quickImportFailures:[]);
      const normalized=normalizeImportedItems(result.items);
      if(retryOnly){const merged=normalizeImportedItems([...quickImportItems,...normalized.items]);quickImportItems=merged.items}else quickImportItems=normalized.items;
      quickImportFailures=Array.isArray(result.failures)?result.failures:[];
      renderQuickImportPreview(quickImportItems,normalized.rejected);renderImportDiagnostics(result,{...normalized,items:quickImportItems});
      $('#quickImportSave')?.classList.toggle('hidden',!quickImportItems.length);$('#seriesImportRetry')?.classList.toggle('hidden',!quickImportFailures.length);
      if(quickImportItems.length)status($('#seriesImportStatus'),`${quickImportItems.length} validated player source${quickImportItems.length===1?'':'s'} ready. ${quickImportFailures.length?`${quickImportFailures.length} episode${quickImportFailures.length===1?'':'s'} can be retried.`:'Review, then Import all.'}`,'success');
      else if(Number(result.episodes_discovered||0)>0)status($('#seriesImportStatus'),`Episodes were found (${result.episodes_discovered}), but no public player sources were detected.`,'error');
      else status($('#seriesImportStatus'),result.message||'No episodes or importable player sources were detected.','error');
    }catch(err){
      if(!retryOnly){quickImportItems=[];quickImportFailures=[];$('#quickImportSave')?.classList.add('hidden');$('#seriesImportRetry')?.classList.add('hidden');$('#quickImportPreview').innerHTML=''}
      status($('#seriesImportStatus'),`Automatic import failed: ${err.message}`,'error');
      const authFail=/authorization failed \(401\)/i.test(err.message);setImporterHealth(authFail?'warn':'error',authFail?'Worker reachable · admin auth failed':'Importer request failed',err.message);
    }finally{if(btn)btn.disabled=false}
  }
  $('#seriesImportFetch')?.addEventListener('click',()=>executeAutomaticImport(false));
  $('#seriesImportRetry')?.addEventListener('click',()=>executeAutomaticImport(true));

  function parseQuickImport(){
    const raw=$('#quickImportInput')?.value||''; const start=Math.max(1,Number($('#quickImportStart')?.value)||1);
    const iframe=[...raw.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map(m=>m[1]);
    const lines=iframe.length?iframe:raw.split(/\n+/).map(x=>x.trim()).filter(Boolean).map(x=>{const m=x.match(/https?:\/\/[^\s"'<>]+/i);return m?m[0]:''}).filter(Boolean);
    quickImportItems=[]; const rejected=[]; const seen=new Set(); let auto=start;
    for(const url of lines){const meta=inferSourceMeta(url);if(!meta.valid){rejected.push({url,reason:meta.reason});continue}if(seen.has(meta.url))continue;seen.add(meta.url);const original=raw.split(/\n+/).find(x=>x.includes(url))||'';const n=Number((original.match(/(?:episode|ep)?\s*#?\s*(\d{1,4})/i)||[])[1])||auto++;quickImportItems.push({episode_number:n,url:meta.url,provider:meta.provider,source_type:meta.source_type,validation:'valid'})}
    renderQuickImportPreview(quickImportItems,rejected);$('#quickImportSave')?.classList.toggle('hidden',!quickImportItems.length);status($('#quickImportStatus'),quickImportItems.length?`${quickImportItems.length} valid source${quickImportItems.length===1?'':'s'} ready${rejected.length?` · ${rejected.length} URL${rejected.length===1?'':'s'} rejected`:''}.`:rejected.length?'No player URLs found. Webpage/watch-page URLs were rejected.':'');
  }
  $('#quickImportAnalyze')?.addEventListener('click',parseQuickImport);
  $('#quickImportSave')?.addEventListener('click',async()=>{
    if(!quickImportItems.length)return;const btn=$('#quickImportSave');btn.disabled=true;status($('#quickImportStatus'),'Importing validated sources…');
    try{await refreshIfNeeded();const providerOverride=($('#quickImportProvider')?.value.trim()||'').toLowerCase().slice(0,60);let added=0,created=0,skipped=0;
      for(const item of quickImportItems){let ep=currentEpisodes.find(e=>Number(e.episode_number)===item.episode_number);if(!ep){const rows=await api('/rest/v1/episodes',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({drama_id:activeDrama.id,episode_number:item.episode_number,title:'',published:false})});ep=rows?.[0];created++;currentEpisodes.push(ep)}const existing=episodeSourcesByEpisode.get(ep.id)||[];if(existing.some(x=>x.source_url===item.url)){skipped++;continue}const priority=(existing.reduce((m,x)=>Math.max(m,Number(x.priority)||0),0)||0)+1;const provider=(item.provider&&item.provider!=='external')?item.provider:(providerOverride||'external');await api('/rest/v1/episode_sources',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({episode_id:ep.id,provider,server_label:`Server ${priority}`,source_type:item.source_type||'embed',source_url:item.url,priority,active:true})});existing.push({source_url:item.url,priority});episodeSourcesByEpisode.set(ep.id,existing);added++}
      status($('#quickImportStatus'),`${added} source${added===1?'':'s'} imported${created?` · ${created} new episode${created===1?'':'s'}`:''}${skipped?` · ${skipped} duplicate${skipped===1?'':'s'} skipped`:''}.`,'success');quickImportItems=[];quickImportFailures=[];$('#quickImportInput').value='';$('#quickImportPreview').innerHTML='';$('#seriesImportDiagnostics')?.classList.add('hidden');$('#seriesImportRetry')?.classList.add('hidden');btn.classList.add('hidden');await loadEpisodes();await loadDramas();
    }catch(err){status($('#quickImportStatus'),`Import-to-Supabase failed: ${err.message}`,'error')}finally{btn.disabled=false}
  });

  function resetBulkQueue(){
    if(bulkUploading) return;
    bulkItems=[];
    const input=$('#bulkEpisodeFiles'); if(input) input.value='';
    if($('#bulkQueue')) $('#bulkQueue').innerHTML='';
    if($('#bulkSummary')) $('#bulkSummary').textContent='No files selected.';
    if($('#bulkStatus')) status($('#bulkStatus'),'');
    if($('#bulkUploadBtn')){$('#bulkUploadBtn').disabled=true;$('#bulkUploadBtn').textContent='Upload all'}
    if($('#bulkClearBtn')) $('#bulkClearBtn').disabled=false;
    if($('#bulkOverallProgress')){$('#bulkOverallProgress').classList.add('hidden');$('#bulkOverallProgress').querySelector('div').style.width='0%'}
  }

  function acceptBulkFiles(fileList){
    if(bulkUploading) return;
    const files=[...fileList].filter(f=>f.type.startsWith('video/')||/\.(mp4|webm|mov|m4v)$/i.test(f.name));
    if(!files.length) return status($('#bulkStatus'),'No supported video files were selected.','error');
    files.sort((a,b)=>collator.compare(a.name,b.name));
    bulkItems=files.map(file=>({file,episode:0,state:'waiting',progress:0,error:''}));
    $('#bulkStartNumber').value=nextEpisodeNumber();
    status($('#bulkStatus'),'');
    assignBulkNumbers();
  }

  function assignBulkNumbers(){
    if(!bulkItems.length) return;
    const start=Math.max(1,Number($('#bulkStartNumber').value)||1);
    const existing=new Set(currentEpisodes.map(e=>Number(e.episode_number)));
    bulkItems.forEach((item,i)=>{item.episode=start+i;item.conflict=existing.has(item.episode);item.oversize=item.file.size>maxVideoBytes});
    renderBulkQueue();
  }

  function renderBulkQueue(){
    const invalid=bulkItems.filter(x=>x.conflict||x.oversize).length;
    const done=bulkItems.filter(x=>x.state==='done').length;
    const failed=bulkItems.filter(x=>x.state==='failed').length;
    const totalSize=bulkItems.reduce((n,x)=>n+x.file.size,0);
    $('#bulkSummary').textContent=bulkItems.length?`${bulkItems.length} files · ${humanSize(totalSize)}${invalid?` · ${invalid} needs attention`:''}`:'No files selected.';
    $('#bulkQueue').innerHTML=bulkItems.map((item,i)=>{
      const issue=item.oversize?'Over 1 GB':item.conflict?`Episode ${item.episode} already exists`:'';
      const stateLabel=item.state==='uploading'?`Uploading ${item.progress}%`:item.state==='saving'?'Saving…':item.state==='done'?'Uploaded':item.state==='failed'?'Failed':issue||'Ready';
      return `<article class="bulk-row ${item.state} ${issue?'invalid':''}" data-bulk-row="${i}">
        <div class="bulk-episode">EP ${String(item.episode).padStart(2,'0')}</div>
        <div class="bulk-file"><strong title="${esc(item.file.name)}">${esc(item.file.name)}</strong><span>${humanSize(item.file.size)}</span>${item.error?`<small>${esc(item.error)}</small>`:''}</div>
        <div class="bulk-row-status"><span>${esc(stateLabel)}</span><div class="mini-progress"><i style="width:${item.state==='done'?100:item.progress}%"></i></div></div>
      </article>`;
    }).join('');
    const retryable=failed>0&&done+failed===bulkItems.length;
    $('#bulkUploadBtn').textContent=retryable?'Retry failed':'Upload all';
    $('#bulkUploadBtn').disabled=bulkUploading||!bulkItems.length||invalid>0||(!retryable&&done===bulkItems.length);
    $('#bulkClearBtn').disabled=bulkUploading;
  }

  function bulkOverallPercent(){
    const total=bulkItems.reduce((n,x)=>n+x.file.size,0)||1;
    const uploaded=bulkItems.reduce((n,x)=>{
      if(x.state==='done') return n+x.file.size;
      if(x.state==='uploading'||x.state==='saving') return n+x.file.size*(x.state==='saving'?1:x.progress/100);
      return n;
    },0);
    return Math.max(0,Math.min(100,Math.round(uploaded/total*100)));
  }
  function updateBulkProgress(label='Uploading batch…'){
    const bar=$('#bulkOverallProgress');
    const pct=bulkOverallPercent();
    bar.classList.remove('hidden');
    bar.querySelector('div').style.width=`${pct}%`;
    bar.querySelector('span').textContent=`${label} ${pct}%`;
  }

  async function runBulkUpload(){
    if(bulkUploading||!bulkItems.length) return;
    const invalid=bulkItems.find(x=>x.conflict||x.oversize);
    if(invalid) return status($('#bulkStatus'),'Fix the episode-number conflict or oversized file before uploading.','error');
    if(!config.r2UploadEndpoint) return status($('#bulkStatus'),'Cloudflare R2 is not connected yet.','error');
    bulkUploading=true;
    $('#bulkUploadBtn').disabled=true;$('#bulkClearBtn').disabled=true;$('#bulkStartNumber').disabled=true;$('#bulkEpisodeFiles').disabled=true;
    status($('#bulkStatus'),'Bulk upload started. Keep this tab open until the batch is finished.');
    updateBulkProgress('Uploading batch…');
    const scheduled=$('#bulkSchedule')?.checked;
    const publish=$('#bulkPublish').checked||scheduled;
    const scheduleStart=scheduled?new Date($('#bulkScheduleStart').value):null;
    const scheduleEvery=Math.max(1,Number($('#bulkScheduleInterval').value)||24);
    if(scheduled && (!scheduleStart || Number.isNaN(scheduleStart.getTime()))){bulkUploading=false;$('#bulkUploadBtn').disabled=false;return status($('#bulkStatus'),'Choose a valid first release date and time.','error');}
    let success=0, failed=0;
    for(let i=0;i<bulkItems.length;i++){
      const item=bulkItems[i];
      if(item.state==='done') continue;
      item.state='uploading';item.progress=0;item.error='';renderBulkQueue();
      try{
        const ok=await refreshIfNeeded();
        if(!ok||!session?.access_token) throw new Error('Admin session expired. Sign in again, then retry failed uploads.');
        const out=await uploadR2(item.file,'video',{dramaId:activeDrama.id,episode:item.episode},pct=>{
          item.progress=pct;
          const row=$(`[data-bulk-row="${i}"]`);
          if(row){row.querySelector('.bulk-row-status>span').textContent=`Uploading ${pct}%`;row.querySelector('.mini-progress i').style.width=`${pct}%`}
          updateBulkProgress('Uploading batch…');
        });
        item.state='saving';item.progress=100;renderBulkQueue();updateBulkProgress('Saving…');
        const publishAt=scheduled?new Date(scheduleStart.getTime()+i*scheduleEvery*3600000).toISOString():null;
        await api('/rest/v1/episodes',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({drama_id:activeDrama.id,episode_number:item.episode,title:'',video_key:out.key,video_url:out.url,published:publish,publish_at:publishAt})});
        item.state='done';item.progress=100;success++;
      }catch(err){
        item.state='failed';item.error=err.message;failed++;
      }
      renderBulkQueue();updateBulkProgress('Uploading batch…');
    }
    bulkUploading=false;
    $('#bulkStartNumber').disabled=false;$('#bulkEpisodeFiles').disabled=false;$('#bulkClearBtn').disabled=false;
    await loadEpisodes();await loadDramas();
    renderBulkQueue();
    const completed=bulkItems.filter(x=>x.state==='done').length;
    const remaining=bulkItems.filter(x=>x.state==='failed').length;
    if(!remaining){
      $('#bulkOverallProgress').querySelector('div').style.width='100%';
      $('#bulkOverallProgress').querySelector('span').textContent='Batch complete 100%';
      status($('#bulkStatus'),`${completed} episode${completed===1?'':'s'} uploaded successfully${scheduled?' and scheduled':publish?' and published':' as drafts'}.`,'success');
    }else{
      status($('#bulkStatus'),`${completed} uploaded · ${remaining} failed. You can click “Retry failed”.`,'error');
    }
  }


  $('#publishAllDraftsBtn')?.addEventListener('click',async()=>{
    const drafts=currentEpisodes.filter(e=>!e.published); if(!drafts.length)return;
    if(!confirm(`Publish all ${drafts.length} draft episode${drafts.length===1?'':'s'} now?`))return;
    try{const b=$('#publishAllDraftsBtn');b.disabled=true;b.textContent='Publishing…';await api(`/rest/v1/episodes?drama_id=eq.${activeDrama.id}&published=eq.false`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({published:true,publish_at:null})});status($('#episodeStatus'),`${drafts.length} draft episode${drafts.length===1?'':'s'} published.`,'success');await loadEpisodes();await loadDramas();await loadAuditLog()}catch(err){status($('#episodeStatus'),err.message,'error');renderEpisodes()}
  });


  $('#bulkSchedule')?.addEventListener('change',()=>{
    const on=$('#bulkSchedule').checked;
    $('#bulkScheduleFields')?.classList.toggle('hidden',!on);
    if(on){$('#bulkPublish').checked=true;$('#bulkPublish').disabled=true;if(!$('#bulkScheduleStart').value){const d=new Date(Date.now()+3600000);d.setMinutes(0,0,0);$('#bulkScheduleStart').value=localDateTimeValue(d.toISOString())}}
    else $('#bulkPublish').disabled=false;
  });

  function selectedEpisodeIds(){return [...document.querySelectorAll('[data-episode-select]:checked')].map(x=>x.dataset.episodeSelect)}
  function syncEpisodeSelectionUI(){
    const ids=selectedEpisodeIds(),all=currentEpisodes.length&&ids.length===currentEpisodes.length;
    if($('#selectAllEpisodes')){$('#selectAllEpisodes').checked=!!all;$('#selectAllEpisodes').indeterminate=ids.length>0&&!all}
    if($('#applyEpisodeBulkBtn')){$('#applyEpisodeBulkBtn').disabled=!ids.length;$('#applyEpisodeBulkBtn').textContent=ids.length?`Apply to ${ids.length} selected`:'Apply to selected'}
  }
  $('#episodeList')?.addEventListener('change',e=>{if(e.target.matches('[data-episode-select]'))syncEpisodeSelectionUI()});
  $('#selectAllEpisodes')?.addEventListener('change',e=>{document.querySelectorAll('[data-episode-select]').forEach(x=>x.checked=e.target.checked);syncEpisodeSelectionUI()});
  $('#episodeBulkAction')?.addEventListener('change',()=>{
    const action=$('#episodeBulkAction').value;
    document.querySelectorAll('[data-bulk-field]').forEach(el=>el.classList.toggle('hidden',el.dataset.bulkField!==action));
    if(action==='schedule'&&!$('#episodeScheduleStart').value){const d=new Date(Date.now()+3600000);d.setMinutes(0,0,0);$('#episodeScheduleStart').value=localDateTimeValue(d.toISOString())}
  });
  $('#applyEpisodeBulkBtn')?.addEventListener('click',async()=>{
    const ids=selectedEpisodeIds();if(!ids.length)return;
    const action=$('#episodeBulkAction').value,st=$('#episodeBulkStatus');
    status(st,'Applying changes…');
    try{
      const rows=currentEpisodes.filter(e=>ids.includes(e.id));
      if(action==='publish'){
        for(const e of rows)await api(`/rest/v1/episodes?id=eq.${e.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({published:true,publish_at:null})});
      }else if(action==='draft'){
        for(const e of rows)await api(`/rest/v1/episodes?id=eq.${e.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({published:false,publish_at:null})});
      }else if(action==='schedule'){
        const start=new Date($('#episodeScheduleStart').value),interval=Math.max(1,Number($('#episodeScheduleInterval').value)||24);
        if(Number.isNaN(start.getTime()))throw new Error('Choose a valid first release date and time.');
        const ordered=[...rows].sort((a,b)=>a.episode_number-b.episode_number);
        for(let i=0;i<ordered.length;i++)await api(`/rest/v1/episodes?id=eq.${ordered[i].id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({published:true,publish_at:new Date(start.getTime()+i*interval*3600000).toISOString()})});
      }else if(action==='rename'){
        const pattern=$('#episodeRenamePattern').value.trim()||'Episode {n}';
        for(const e of rows)await api(`/rest/v1/episodes?id=eq.${e.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({title:pattern.replaceAll('{n}',String(e.episode_number)).replaceAll('{nn}',String(e.episode_number).padStart(2,'0'))})});
      }
      status(st,`Updated ${rows.length} episode${rows.length===1?'':'s'}.`,'success');await loadEpisodes();await loadDramas();await loadAuditLog();
    }catch(err){status(st,err.message,'error')}
  });

  $('#bulkEpisodeFiles').addEventListener('change',e=>acceptBulkFiles(e.target.files||[]));
  $('#bulkStartNumber').addEventListener('input',assignBulkNumbers);
  $('#bulkClearBtn').addEventListener('click',resetBulkQueue);
  $('#bulkUploadBtn').addEventListener('click',runBulkUpload);
  const drop=$('#bulkDropzone');
  ['dragenter','dragover'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();if(!bulkUploading)drop.classList.add('dragging')}));
  ['dragleave','drop'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('dragging')}));
  drop.addEventListener('drop',e=>{if(!bulkUploading)acceptBulkFiles(e.dataTransfer?.files||[])});

  window.addEventListener('beforeunload',e=>{if(bulkUploading){e.preventDefault();e.returnValue=''}});

  document.addEventListener('click',async e=>{
    const rq=e.target.closest('[data-request-status]');if(rq){try{await api(`/rest/v1/content_requests?id=eq.${rq.dataset.requestId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:rq.dataset.requestStatus})});await loadContentRequests()}catch(err){alert(err.message)}}
    const rp=e.target.closest('[data-report-status]');if(rp){try{const done=['resolved','dismissed'].includes(rp.dataset.reportStatus);await api(`/rest/v1/episode_reports?id=eq.${rp.dataset.reportId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:rp.dataset.reportStatus,resolved_at:done?new Date().toISOString():null,resolved_by:done?session.user.id:null})});await loadEpisodeReports()}catch(err){alert(err.message)}}
    const addSrc=e.target.closest('[data-add-source]');if(addSrc){const num=Number(addSrc.dataset.addSource);editingSourceId=null;editingSourceEpisodeId=null;$('#addEpisodeBtn').textContent='Add source';$('#episodeNumber').readOnly=false;$('#episodeNumber').value=num;$('#episodeServerLabel').value=`Server ${(episodeSourcesByEpisode.get(currentEpisodes.find(x=>Number(x.episode_number)===num)?.id)||[]).length+1}`;$('#episodeSourceUrl').value='';$('#episodeSourceUrl').focus();$('#singleEpisodePanel').scrollIntoView({behavior:'smooth',block:'start'});}
    const editSrc=e.target.closest('[data-edit-source]');if(editSrc){const src=[...episodeSourcesByEpisode.values()].flat().find(x=>x.id===editSrc.dataset.editSource);if(src){editingSourceId=src.id;editingSourceEpisodeId=src.episode_id;$('#episodeNumber').value=Number(editSrc.dataset.episodeNumber);$('#episodeNumber').readOnly=true;$('#episodeProvider').value=src.provider||'external';$('#episodeServerLabel').value=src.server_label||`Server ${src.priority}`;$('#episodeSourceType').value=src.source_type||'embed';$('#episodeSourceUrl').value=src.source_url||'';$('#addEpisodeBtn').textContent='Save source';status($('#episodeStatus'),'Editing player source.');$('#singleEpisodePanel').scrollIntoView({behavior:'smooth',block:'start'});}}
    const toggleSrc=e.target.closest('[data-toggle-source]');if(toggleSrc){const src=[...episodeSourcesByEpisode.values()].flat().find(x=>x.id===toggleSrc.dataset.toggleSource);if(src){try{await api(`/rest/v1/episode_sources?id=eq.${src.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({active:!src.active})});await loadEpisodes()}catch(err){status($('#episodeStatus'),err.message,'error')}}}
    const moveSrc=e.target.closest('[data-move-source]');if(moveSrc){const list=episodeSourcesByEpisode.get(moveSrc.dataset.episodeId)||[];const idx=list.findIndex(x=>x.id===moveSrc.dataset.sourceId);const swapIdx=moveSrc.dataset.moveSource==='up'?idx-1:idx+1;if(idx>=0&&swapIdx>=0&&swapIdx<list.length){const a=list[idx],b=list[swapIdx];try{await api(`/rest/v1/episode_sources?id=eq.${a.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({priority:b.priority})});await api(`/rest/v1/episode_sources?id=eq.${b.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({priority:a.priority})});await loadEpisodes()}catch(err){status($('#episodeStatus'),err.message,'error')}}}
    const delSrc=e.target.closest('[data-delete-source]');if(delSrc&&confirm('Remove this playback source?')){try{await api(`/rest/v1/episode_sources?id=eq.${delSrc.dataset.deleteSource}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});if(editingSourceId===delSrc.dataset.deleteSource){editingSourceId=null;editingSourceEpisodeId=null;$('#addEpisodeBtn').textContent='Add source';$('#episodeNumber').readOnly=false;$('#episodeSourceUrl').value=''}await loadEpisodes()}catch(err){status($('#episodeStatus'),err.message,'error')}}
    const t=e.target.closest('[data-toggle-episode]');if(t){try{await api(`/rest/v1/episodes?id=eq.${t.dataset.toggleEpisode}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({published:t.dataset.live!=='true',publish_at:t.dataset.live==='true'?null:null})});await loadEpisodes();await loadDramas()}catch(err){status($('#episodeStatus'),err.message,'error')}}
    const d=e.target.closest('[data-delete-episode]');if(d&&confirm('Delete this episode record?')){try{await api(`/rest/v1/episodes?id=eq.${d.dataset.deleteEpisode}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});await loadEpisodes();await loadDramas()}catch(err){status($('#episodeStatus'),err.message,'error')}}
  });

  try{session=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{}
  (async()=>{if(!base||!key)return showLogin('Supabase is not configured.');if(session){try{await verifyAdmin();await showDashboard()}catch(err){clearSession();showLogin(err.message)}}else showLogin()})();
})();

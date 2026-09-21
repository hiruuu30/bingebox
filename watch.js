(() => {
  const config=window.BINGEBOX_CONFIG||{};
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const video=$('#swipeVideo'),embed=$('#swipeEmbed'),shell=$('#swipeShell'),loading=$('#swipeLoading'),playBtn=$('#swipePlay'),speedHold=$('#speedHold'),landscapeBtn=$('#swipeLandscape');
  const episodeSheet=$('#episodeSheet'),moreSheet=$('#moreSheet'),reportDialog=$('#swipeReportDialog'),centerControls=$('#swipeCenterControls');
  const progressRange=$('#swipeProgressRange'),progressCurrent=$('#swipeCurrentTime'),progressDuration=$('#swipeDuration'),progressWrap=$('#swipeProgress');let scrubbing=false;
  const emoji={heart:'❤️',shock:'😱',laugh:'😂',fire:'🔥'};
  let feed=[],index=0,seq=0,touchY=null,touchX=null,edgeBack=false,edgeBackDx=0,lastSave=0,lastCloud=0,streamCache=new Map(),sourceCache=new Map(),chromeTimer=null,autoplayCancelled=false,lastCueSecond=null,navLockUntil=0,currentMode='direct',holdTimer=null,holdSpeed=false,preHoldRate=1,rateRamp=0,holdPointerId=null,suppressTapUntil=0,currentSourceIndex=0,qualifiedSent=false,playSeconds=0,lastPlayTick=0,milestones=new Set(),startedEpisodeId=null,loadTimer=null,feedAbort=null,autoFailoverTried=new Set(),randomModeActive=false,hlsController=null;
  const localKey=item=>`bb-progress:${item.slug}:${item.episode_number}`;
  const getLocal=item=>{try{return Number(localStorage.getItem(localKey(item))||0)}catch{return 0}};
  const visitorToken=()=>window.BBUser?.visitorToken?.()||(()=>{const k='bb-visitor-token';try{let v=localStorage.getItem(k);if(v)return v;v=crypto.randomUUID();localStorage.setItem(k,v);return v}catch{return '00000000-0000-4000-8000-000000000001'}})();
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast=msg=>{const t=$('#swipeToast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),1800)};
  function destroyHls(){
    if(!hlsController)return;
    try{hlsController.destroy?.()}catch{}
    hlsController=null;
  }
  function needsHlsRelay(url){
    try{
      const u=new URL(String(url||''),location.href);
      return u.hostname.toLowerCase()==='akamai-static.shorttv.live'&&u.pathname.startsWith('/hls-encrypted/');
    }catch{return false}
  }
  function relayHlsUrl(url){
    return '/api/hls-proxy?url='+encodeURIComponent(String(url||''));
  }
  function attachVideoSource(url,sourceType,onFatal){
    destroyHls();
    const isHls=sourceType==='hls'||/\.m3u8(?:$|[?#])/i.test(String(url||''));
    if(!isHls){video.src=url;video.load();return}
    const playbackUrl=needsHlsRelay(url)?relayHlsUrl(url):url;
    if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=playbackUrl;video.load();return}
    const H=window.Hls;
    if(!H?.isSupported?.())throw new Error('HLS playback is not supported in this browser.');
    const h=new H({enableWorker:true,lowLatencyMode:false,backBufferLength:60,maxBufferLength:30});
    hlsController=h;
    h.on(H.Events.ERROR,(_event,data)=>{
      if(!data?.fatal)return;
      try{h.destroy()}catch{}
      if(hlsController===h)hlsController=null;
      onFatal?.(data?.details||data?.type||'HLS stream failed');
    });
    h.loadSource(playbackUrl);
    h.attachMedia(video);
  }
  function setChrome(show=true,hold=false){
    if(!loading.classList.contains('hidden')&&loading.querySelector('.playback-failure')){show=true;hold=true}
    shell.classList.toggle('controls-visible',show);
    if(chromeTimer)clearTimeout(chromeTimer);
    if(!show){closeReactionTray();return}
    if(show&&!hold)chromeTimer=setTimeout(()=>{shell.classList.remove('controls-visible');closeReactionTray()},2200)
  }
  function closeReactionTray(){const tray=$('#reactionTray'),btn=$('#swipeReact');tray.classList.add('hidden');btn.setAttribute('aria-expanded','false')}
  const isPhysicalLandscape=()=>window.matchMedia?.('(orientation: landscape)').matches||window.innerWidth>window.innerHeight;
  function syncMediaLayout(){
    const sourceLandscape=currentMode==='direct'&&video.videoWidth>0&&video.videoWidth>video.videoHeight*1.08;
    const deviceLandscape=isPhysicalLandscape();
    const fullscreen=Boolean(document.fullscreenElement||document.webkitFullscreenElement||video.webkitDisplayingFullscreen);
    shell.classList.toggle('media-landscape',sourceLandscape);
    shell.classList.toggle('device-landscape',deviceLandscape);
    document.documentElement.classList.toggle('player-landscape',sourceLandscape&&deviceLandscape);
    document.body.classList.toggle('player-landscape',sourceLandscape&&deviceLandscape);
    landscapeBtn?.classList.toggle('hidden',!sourceLandscape);
    landscapeBtn?.classList.toggle('active',sourceLandscape&&(fullscreen||deviceLandscape||shell.classList.contains('landscape-mode')));
    landscapeBtn?.setAttribute('aria-pressed',sourceLandscape&&(fullscreen||deviceLandscape||shell.classList.contains('landscape-mode'))?'true':'false');
  }
  async function toggleLandscape(){
    if(currentMode!=='direct'||!(video.videoWidth>video.videoHeight*1.08))return;
    const fullscreen=Boolean(document.fullscreenElement||document.webkitFullscreenElement||video.webkitDisplayingFullscreen);
    if(fullscreen||shell.classList.contains('landscape-mode')){
      try{screen.orientation?.unlock?.()}catch{}
      shell.classList.remove('landscape-mode');
      try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.webkitFullscreenElement)await document.webkitExitFullscreen?.()}catch{}
      syncMediaLayout();return;
    }
    shell.classList.add('landscape-mode');
    try{
      if(shell.requestFullscreen){await shell.requestFullscreen({navigationUI:'hide'}).catch(()=>shell.requestFullscreen())}
      else if(shell.webkitRequestFullscreen){shell.webkitRequestFullscreen()}
      else if(video.webkitEnterFullscreen){video.webkitEnterFullscreen()}
      try{await screen.orientation?.lock?.('landscape')}catch{}
    }catch{
      try{video.webkitEnterFullscreen?.()}catch{}
    }
    syncMediaLayout();setChrome(true);
  }

  function firstRunHint(){try{if(localStorage.getItem('bb-swipe-hint-seen'))return;const h=$('#swipeHint');h.classList.remove('hidden');setTimeout(()=>{h.classList.add('hidden');localStorage.setItem('bb-swipe-hint-seen','1')},3200)}catch{}}

  async function streamUrl(item){
    const cached=streamCache.get(item.video_key),now=Math.floor(Date.now()/1000);if(cached&&cached.expiresAt-now>90)return cached.url;
    const endpoint=config.secureMediaEndpoint||'/api/stream';const res=await fetch(`${endpoint}?key=${encodeURIComponent(item.video_key)}`,{headers:{Accept:'application/json'},cache:'no-store'});const data=await res.json().catch(()=>({}));
    if(!res.ok||!data.url)throw new Error(data.error||'Secure playback unavailable.');streamCache.set(item.video_key,{url:data.url,expiresAt:Number(data.expiresAt||0)});return data.url;
  }
  async function reactionApi(path,body){const base=(config.supabaseUrl||'').replace(/\/$/,'');const res=await fetch(`${base}${path}`,{method:'POST',headers:{apikey:config.supabasePublishableKey,'Content-Type':'application/json',Accept:'application/json',...(BBUser?.getAuthHeader?.()||{})},body:JSON.stringify(body),cache:'no-store'});const data=await res.json().catch(()=>null);if(!res.ok)throw new Error(data?.message||data?.error||'Request failed.');return data}
  async function fetchAllRows(url,headers,pageSize=1000){
    const out=[];let offset=0;
    while(true){
      const sep=url.includes('?')?'&':'?';
      const res=await fetch(`${url}${sep}limit=${pageSize}&offset=${offset}`,{headers,cache:'no-store'});
      if(!res.ok)throw new Error('Player is temporarily unavailable.');
      const batch=await res.json();out.push(...batch);
      if(batch.length<pageSize)break;
      offset+=pageSize;
    }
    return out;
  }
  async function fetchSourcesForEpisode(base,headers,episodeId){
    if(!episodeId)return [];
    if(sourceCache.has(episodeId))return sourceCache.get(episodeId);
    const url=`${base}/rest/v1/episode_sources?episode_id=eq.${encodeURIComponent(episodeId)}&active=eq.true&select=episode_id,provider,server_label,source_type,source_url,priority,source_stability,health_status,expires_at&order=priority.asc`;
    const res=await fetch(url,{headers,cache:'no-store'});
    if(!res.ok)throw new Error('Playback sources are temporarily unavailable.');
    const rows=await res.json();
    sourceCache.set(episodeId,rows||[]);
    return rows||[];
  }

  async function ensureSources(item){
    if(!item)return [];
    if(item.sourcesLoaded)return item.sources||[];
    const base=(config.supabaseUrl||'').replace(/\/$/,''),headers={apikey:config.supabasePublishableKey,Accept:'application/json'};
    item.sources=await fetchSourcesForEpisode(base,headers,item.episode_id);
    item.sourcesLoaded=true;
    return item.sources;
  }

  function prefetchNeighborSources(){
    const nextIndex=nextWithinDrama();
    const item=nextIndex>=0?feed[nextIndex]:null;
    if(item&&!item.sourcesLoaded)ensureSources(item).catch(()=>{});
  }

  function normalizeFeedRow(e,d=null,order=0){
    const drama=d||e;
    return {
      episode_id:e.episode_id||e.id,drama_id:e.drama_id,episode_number:Number(e.episode_number),episode_title:e.episode_title??e.title??'',duration_seconds:e.duration_seconds,video_key:e.video_key,video_url:e.video_url,
      sources:[],sourcesLoaded:false,slug:drama.slug,title:drama.title,poster_url:drama.poster_url,is_complete:!!drama.is_complete,drama_order:order
    };
  }

  async function loadFeed(){
    if(feedAbort)feedAbort.abort();
    feedAbort=new AbortController();
    try{
      if(window.BBUser)await BBUser.ready;
      const base=(config.supabaseUrl||'').replace(/\/$/,''),headers={apikey:config.supabasePublishableKey,Accept:'application/json'},signal=feedAbort.signal;
      const q=new URLSearchParams(location.search),slug=q.get('drama'),requestedEp=Number(q.get('ep')||0),randomMode=q.has('random');
      randomModeActive=randomMode;sourceCache=new Map();
      if(randomMode){
        const rows=await reactionApi('/rest/v1/rpc/get_random_playable_episodes',{p_limit:20});
        feed=(Array.isArray(rows)?rows:[]).map((row,i)=>normalizeFeedRow(row,row,i));
        index=0;
      }else{
        if(!slug)throw new Error('Choose a drama to watch.');
        const res=await fetch(`${base}/rest/v1/dramas?published=eq.true&slug=eq.${encodeURIComponent(slug)}&select=id,slug,title,poster_url,is_complete,sort_order&limit=1`,{headers,signal,cache:'no-store'});
        if(!res.ok)throw new Error('Player is temporarily unavailable.');
        const selectedDrama=(await res.json())?.[0]||null;
        if(!selectedDrama)throw new Error('This drama is unavailable.');
        const rows=await reactionApi('/rest/v1/rpc/get_drama_playable_episodes',{p_drama_id:selectedDrama.id});
        feed=(Array.isArray(rows)?rows:[]).map(row=>normalizeFeedRow(row,selectedDrama,0));
        const i=feed.findIndex(x=>!requestedEp||x.episode_number===requestedEp);index=i>=0?i:0;
      }
      if(!feed.length)throw new Error('No playable episodes are available yet.');
      shell.setAttribute('aria-busy','false');await loadItem(index,false);firstRunHint();BBUser?.track?.('watch_session',{metadata:{random:randomMode}}).catch(()=>{});
    }catch(err){if(err?.name==='AbortError')return;loading.innerHTML=`<p>${escapeHtml(err.message||'Player is temporarily unavailable.')}</p><a href="/" style="color:#FF685C">Back to BingeBox</a>`}
  }

  function renderFavorite(){const item=feed[index],btn=$('#swipeFavorite'),on=BBUser?.isFavorite?.(item.drama_id,item.slug);btn.classList.toggle('active',!!on);btn.setAttribute('aria-pressed',String(!!on));btn.querySelector('span').textContent=on?'✓':'＋'}
  function resetCounts(){$$('[data-swipe-count]').forEach(x=>x.textContent='0')}
  async function loadCounts(item){resetCounts();const rows=await reactionApi('/rest/v1/rpc/get_episode_reaction_totals',{p_episode_id:item.episode_id});(rows||[]).forEach(r=>{const el=document.querySelector(`[data-swipe-count="${r.reaction}"]`);if(el)el.textContent=String(r.total||0)})}
  function burst(r){const n=document.createElement('span');n.className='swipe-burst';n.textContent=emoji[r]||'✨';n.style.right=`${2.5+Math.random()*1.5}rem`;$('#swipeBursts').appendChild(n);setTimeout(()=>n.remove(),1400)}
  function renderEpisodeSheet(){const item=feed[index],same=feed.map((x,i)=>({x,i})).filter(v=>v.x.drama_id===item.drama_id);$('#sheetDramaTitle').textContent=item.title;$('#sheetEpisodes').innerHTML=same.map(({x,i})=>`<button type="button" class="${i===index?'active':''}" data-sheet-index="${i}">EP ${String(x.episode_number).padStart(2,'0')}</button>`).join('')}
  function nextWithinDrama(){if(randomModeActive)return index+1<feed.length?index+1:-1;const item=feed[index];for(let i=index+1;i<feed.length;i++)if(feed[i].drama_id===item.drama_id)return i;return -1}
  function prevWithinDrama(){if(randomModeActive)return index>0?index-1:-1;const item=feed[index];for(let i=index-1;i>=0;i--)if(feed[i].drama_id===item.drama_id)return i;return -1}

  function renderServers(item){
    const picker=$('#serverPicker'),box=$('#serverButtons');if(!picker||!box)return;
    const list=item?.sources||[];picker.classList.toggle('hidden',list.length<2);
    box.innerHTML=list.map((x,i)=>`<button type="button" data-server-index="${i}" class="${i===currentSourceIndex?'active':''}">${escapeHtml(x.server_label||`Server ${i+1}`)}</button>`).join('');
  }
  async function switchServer(i){
    const item=feed[index],list=item?.sources||[];if(!list[i]||i===currentSourceIndex)return;
    currentSourceIndex=i;moreSheet.close();BBUser?.track?.('server_switch',{dramaId:item.drama_id,episodeId:item.episode_id,metadata:{provider:list[i].provider||'external',server:list[i].server_label||`Server ${i+1}`}}).catch(()=>{});toast(`Switching to ${list[i].server_label||`Server ${i+1}`}…`);await loadItem(index,true);
  }
  function clearLoadTimer(){if(loadTimer){clearTimeout(loadTimer);loadTimer=null}}
  function canAutoFailover(item){
    const list=item?.sources||[],key=`${item?.episode_id||''}:${currentSourceIndex}`;
    if(list.length<=currentSourceIndex+1||autoFailoverTried.has(key))return false;
    autoFailoverTried.add(key);currentSourceIndex++;toast(`Trying ${list[currentSourceIndex]?.server_label||`Server ${currentSourceIndex+1}`}…`);loadItem(index,true);return true;
  }
  function playerFailure(message,autoplay=true){
    clearLoadTimer();
    const item=feed[index];if(!item)return;
    if(canAutoFailover(item))return;
    BBUser?.track?.('playback_error',{dramaId:item.drama_id,episodeId:item.episode_id,metadata:{message:String(message||'Playback failed').slice(0,180),mode:currentMode,server:currentSourceIndex+1}}).catch(()=>{});
    const hasNext=(item.sources?.length||0)>currentSourceIndex+1;
    loading.classList.remove('hidden');
    loading.innerHTML=`<div class="playback-failure"><strong>Playback unavailable</strong><p>${escapeHtml(message||'This source did not start in time.')}</p><div><button id="swipeRetry">Retry</button>${hasNext?'<button id="swipeFallback">Try next server</button>':''}<button id="swipeReportIssue" class="report-issue">Report an issue</button></div></div>`;
    $('#swipeRetry')?.addEventListener('click',()=>loadItem(index,autoplay),{once:true});
    $('#swipeFallback')?.addEventListener('click',()=>{currentSourceIndex++;loadItem(index,true)},{once:true});
    $('#swipeReportIssue')?.addEventListener('click',()=>openReport(String(message||'Playback failed')),{once:true});
    setChrome(true,true);
  }

  async function loadItem(next,autoplay=true){
    if(!feed[next])return;save(true);releaseHoldSpeed();clearLoadTimer();destroyHls();video.onerror=null;video.onloadedmetadata=null;video.oncanplay=null;const item=feed[next],previousEpisodeId=feed[index]?.episode_id,s=++seq;index=next;if(previousEpisodeId!==item.episode_id)autoFailoverTried=new Set();autoplayCancelled=false;lastCueSecond=null,navLockUntil=0;qualifiedSent=false;playSeconds=0;lastPlayTick=0;milestones=new Set();$('#swipeNextCue').classList.add('hidden');closeReactionTray();setChrome(true,true);
    loading.classList.remove('hidden');loading.innerHTML='<span></span><p>Loading episode…</p>';video.pause();video.removeAttribute('src');video.load();embed.src='about:blank';embed.classList.add('hidden');video.classList.remove('hidden');
    $('#swipeEpisode').textContent=`EP ${String(item.episode_number).padStart(2,'0')}`;$('#swipeTitle').textContent=item.title;$('#swipeEpisodeTitle').textContent=item.episode_title||`Episode ${item.episode_number}`;$('#swipeComplete').classList.toggle('hidden',!item.is_complete);const sameDrama=feed.filter(x=>x.drama_id===item.drama_id);
    const dramaPos=Math.max(0,sameDrama.findIndex(x=>x.episode_id===item.episode_id));
    $('#swipePosition').textContent=randomModeActive?`SURPRISE · ${index+1} / ${feed.length}`:`${dramaPos+1} / ${sameDrama.length}`;renderFavorite();renderEpisodeSheet();resetCounts();history.replaceState(null,'',`/watch?drama=${encodeURIComponent(item.slug)}&ep=${item.episode_number}`);
    try{
      await ensureSources(item);if(s!==seq)return;
      const src=item.sources?.[currentSourceIndex]||item.sources?.[0]||null;renderServers(item);currentMode=src?.source_type==='embed'?'embed':'direct';shell.classList.remove('landscape-mode');syncMediaLayout();
      if(currentMode==='embed'){video.classList.add('hidden');embed.classList.remove('hidden');embed.src=src.source_url;loading.classList.add('hidden');playBtn.classList.add('hidden');centerControls?.classList.add('embed-disabled');progressWrap?.classList.add('hidden');if(startedEpisodeId!==item.episode_id){startedEpisodeId=item.episode_id;BBUser?.track?.('watch_start',{dramaId:item.drama_id,episodeId:item.episode_id,metadata:{mode:'unified',provider:src.provider||'external'}}).catch(()=>{})}loadCounts(item).catch(()=>{});prefetchNeighborSources();setChrome(true,true);return}
      playBtn.classList.remove('hidden');centerControls?.classList.remove('embed-disabled');progressWrap?.classList.remove('hidden');let url;if(src&&src.provider!=='legacy_r2')url=src.source_url;else if(item.video_key)url=await streamUrl(item);else url=src?.source_url||item.video_url;if(!url)throw new Error('No playable source is available for this episode yet.');
      if(s!==seq)return;
      video.onerror=()=>{if(s!==seq)return;const code=video.error?.code||0;playerFailure(code?`This video source failed to load (media error ${code}).`:'This video source failed to load.',autoplay)};
      let readyHandled=false;
      const onReady=()=>{
        if(s!==seq||readyHandled)return;readyHandled=true;clearLoadTimer();loading.classList.add('hidden');
        const cloud=BBUser?.getProgress?.(item.episode_id),saved=Math.max(getLocal(item),cloud&&!cloud.completed?Number(cloud.seconds||0):0);
        if(Number.isFinite(video.duration)&&saved>5&&saved<video.duration-8){try{video.currentTime=saved}catch{}}
        if(startedEpisodeId!==item.episode_id){startedEpisodeId=item.episode_id;BBUser?.track?.('watch_start',{dramaId:item.drama_id,episodeId:item.episode_id,metadata:{mode:'unified',provider:src?.provider||'legacy'}}).catch(()=>{})}
        loadCounts(item).catch(()=>{});prefetchNeighborSources();
        if(autoplay)video.play().then(()=>setChrome(true)).catch(()=>setChrome(true));else setChrome(true)
      };
      video.onloadedmetadata=onReady;video.oncanplay=onReady;
      video.playsInline=true;video.preload='metadata';
      attachVideoSource(url,src?.source_type||'direct',detail=>{if(s===seq)playerFailure('This HLS source failed to load'+(detail?': '+detail:''),autoplay)});
      loadTimer=setTimeout(()=>{if(s===seq&&video.readyState<1)playerFailure('This source is taking too long to respond. Retry it or try another server.',autoplay)},15000);
    }catch(err){playerFailure(err.message,autoplay)}
  }
  function fmtTime(sec){
    sec=Math.max(0,Number.isFinite(Number(sec))?Math.floor(Number(sec)):0);
    const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
    return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
  }
  function updateProgress(){
    if(!progressRange)return;
    const dur=Number.isFinite(video.duration)&&video.duration>0?video.duration:0,cur=Number.isFinite(video.currentTime)?video.currentTime:0;
    if(!scrubbing)progressRange.value=dur?String(Math.round((cur/dur)*1000)):'0';
    progressRange.style.setProperty('--progress',`${dur?(Number(progressRange.value)/10):0}%`);
    if(progressCurrent)progressCurrent.textContent=fmtTime(scrubbing&&dur?(Number(progressRange.value)/1000)*dur:cur);
    if(progressDuration)progressDuration.textContent=fmtTime(dur);
    progressWrap?.classList.toggle('hidden',currentMode!=='direct'||!dur);
  }
  function save(force=false){const item=feed[index];if(currentMode==='embed'||!item||!Number.isFinite(video.currentTime))return;const now=Date.now();if(!force&&now-lastSave<1500)return;lastSave=now;const sec=Math.max(0,Math.floor(video.currentTime||0)),dur=Number.isFinite(video.duration)?Math.floor(video.duration):Number(item.duration_seconds||0),completed=Boolean(video.ended||(dur>0&&sec>=Math.max(0,dur-1)));try{localStorage.setItem(localKey(item),String(sec));localStorage.setItem(`bb-lastwatch:${item.slug}`,JSON.stringify({episode:item.episode_number,time:sec,duration:dur,at:now,completed}))}catch{}if(BBUser?.getState?.().signedIn&&(force||now-lastCloud>10000)){lastCloud=now;BBUser.saveProgress({episodeId:item.episode_id,dramaId:item.drama_id,seconds:sec,duration:dur,completed}).catch(()=>{})}}
  function complete(){const item=feed[index],dur=Math.floor(video.duration||item.duration_seconds||0),now=Date.now();try{localStorage.setItem(localKey(item),String(dur));localStorage.setItem(`bb-completed:${item.slug}:${item.episode_number}`,'1');localStorage.setItem(`bb-lastwatch:${item.slug}`,JSON.stringify({episode:item.episode_number,time:dur,duration:dur,at:now,completed:true}))}catch{}BBUser?.saveProgress?.({episodeId:item.episode_id,dramaId:item.drama_id,seconds:dur,duration:dur,completed:true}).catch(()=>{});BBUser?.track?.('watch_complete',{dramaId:item.drama_id,episodeId:item.episode_id,value:dur,metadata:{mode:'unified'}}).catch(()=>{})}
  const goNext=()=>{const n=nextWithinDrama();if(n>=0){currentSourceIndex=0;loadItem(n,true)}else if(randomModeActive){location.href='/watch?random=1'}else toast('You reached the latest episode')};const goPrev=()=>{const n=prevWithinDrama();if(n>=0){currentSourceIndex=0;loadItem(n,true)}};
  function navigate(direction){const now=Date.now();if(now<navLockUntil)return;navLockUntil=now+600;direction>0?goNext():goPrev()}
  function returnToDramaDetails(){
    const item=feed[index];if(!item)return;
    save(true);releaseHoldSpeed();
    try{sessionStorage.setItem('bb-returned-from-player',item.slug)}catch{}
    location.href=`/?drama=${encodeURIComponent(item.slug)}`;
  }
  function updateNextCue(){if(!Number.isFinite(video.duration)||video.duration<=0)return;const n=nextWithinDrama(),remain=Math.ceil(video.duration-video.currentTime);if(n<0||autoplayCancelled||remain>5||remain<1){if(remain>5)$('#swipeNextCue').classList.add('hidden');return}if(remain!==lastCueSecond){lastCueSecond=remain;$('#swipeNextCount').textContent=String(remain)}$('#swipeNextCue').classList.remove('hidden')}

  function analyticsPlaybackTick(){
    if(currentMode!=='direct'||video.paused||video.ended||document.visibilityState!=='visible')return;
    const now=Date.now();if(!lastPlayTick){lastPlayTick=now;return}const delta=Math.min(2.5,Math.max(0,(now-lastPlayTick)/1000));lastPlayTick=now;playSeconds+=delta;
    const item=feed[index];if(!item)return;
    if(!qualifiedSent&&playSeconds>=30){qualifiedSent=true;BBUser?.track?.('watch_qualified',{dramaId:item.drama_id,episodeId:item.episode_id,value:Math.floor(playSeconds),metadata:{mode:'unified'}}).catch(()=>{})}
    if(Number.isFinite(video.duration)&&video.duration>0){const pct=Math.floor(video.currentTime/video.duration*100);for(const mark of [25,50,75])if(pct>=mark&&!milestones.has(mark)){milestones.add(mark);BBUser?.track?.('watch_milestone',{dramaId:item.drama_id,episodeId:item.episode_id,value:mark,metadata:{mode:'unified'}}).catch(()=>{})}}
  }
  let analyticsWatchCheckpoint=0;
  function flushMeasuredWatch(force=false){
    const item=feed[index];
    if(!item||currentMode!=='direct')return;
    const measured=Math.max(0,playSeconds-analyticsWatchCheckpoint);
    const whole=Math.floor(measured);
    if(whole<(force?1:20))return;
    analyticsWatchCheckpoint+=whole;
    BBUser?.track?.('watch_time',{dramaId:item.drama_id,episodeId:item.episode_id,value:whole,metadata:{mode:'unified',measurement:'active_playback_delta'}}).catch(()=>{});
  }
  setInterval(()=>flushMeasuredWatch(false),20000);

  video.addEventListener('timeupdate',()=>{save(false);updateNextCue();updateProgress();analyticsPlaybackTick()});video.addEventListener('loadedmetadata',()=>{updateProgress();syncMediaLayout()});video.addEventListener('durationchange',updateProgress);video.addEventListener('play',()=>{lastPlayTick=Date.now();playBtn.classList.add('playing');const s=playBtn.querySelector('span');if(s)s.textContent='Ⅱ';setChrome(true)});video.addEventListener('pause',()=>{flushMeasuredWatch(true);lastPlayTick=0;playBtn.classList.remove('playing');const s=playBtn.querySelector('span');if(s)s.textContent='▶';setChrome(true)});video.addEventListener('ended',()=>{complete();$('#swipeNextCue').classList.add('hidden');if(!autoplayCancelled)setTimeout(goNext,220)});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){releaseHoldSpeed();flushMeasuredWatch(true);save(true)}});window.addEventListener('pagehide',()=>{flushMeasuredWatch(true);save(true);destroyHls();feedAbort?.abort?.()});
  const NORMAL_PLAYBACK_RATE=1;
  function setPlaybackRateImmediate(rate){
    cancelAnimationFrame(rateRamp);rateRamp=0;
    const safe=Number.isFinite(Number(rate))?Number(rate):NORMAL_PLAYBACK_RATE;
    video.defaultPlaybackRate=safe;video.playbackRate=safe;
  }
  function holdGestureAllowed(e){
    if(currentMode!=='direct'||video.paused||video.ended||holdSpeed)return false;
    if(e?.pointerType==='mouse'&&e.button!==0)return false;
    const t=e?.target;
    if(!t)return true;
    return !t.closest?.('button,a,input,select,textarea,dialog,[role="button"],.swipe-progress,.reaction-tray,.swipe-actions,.swipe-top');
  }
  function beginHoldSpeed(e){
    if(!holdGestureAllowed(e))return;
    holdPointerId=e?.pointerId??null;
    try{if(holdPointerId!=null)shell.setPointerCapture?.(holdPointerId)}catch{}
    clearTimeout(holdTimer);
    holdTimer=setTimeout(()=>{
      holdTimer=null;
      if(currentMode!=='direct'||video.paused||video.ended)return;
      holdSpeed=true;suppressTapUntil=Date.now()+320;
      setPlaybackRateImmediate(2);
      speedHold?.classList.remove('hidden','releasing');
      speedHold?.setAttribute('aria-hidden','false');
      shell.classList.add('speed-active');
      navigator.vibrate?.(8);
    },180);
  }
  function releaseHoldSpeed(e){
    if(e?.pointerId!=null&&holdPointerId!=null&&e.pointerId!==holdPointerId)return;
    clearTimeout(holdTimer);holdTimer=null;
    try{if(holdPointerId!=null&&shell.hasPointerCapture?.(holdPointerId))shell.releasePointerCapture?.(holdPointerId)}catch{}
    holdPointerId=null;
    const wasHolding=holdSpeed;holdSpeed=false;
    // The interaction contract is always: hold = 2x, release/cancel = normal 1x.
    if(currentMode==='direct')setPlaybackRateImmediate(NORMAL_PLAYBACK_RATE);
    shell.classList.remove('speed-active');
    if(!wasHolding){speedHold?.classList.add('hidden');speedHold?.classList.remove('releasing');return}
    speedHold?.classList.add('releasing');speedHold?.setAttribute('aria-hidden','true');
    setTimeout(()=>{if(holdSpeed)return;speedHold?.classList.add('hidden');speedHold?.classList.remove('releasing')},110);
  }
  shell.addEventListener('pointerdown',beginHoldSpeed,{passive:true});
  window.addEventListener('pointerup',releaseHoldSpeed,true);
  window.addEventListener('pointercancel',releaseHoldSpeed,true);
  window.addEventListener('blur',()=>releaseHoldSpeed());
  video.addEventListener('pause',()=>releaseHoldSpeed());
  video.addEventListener('ended',()=>releaseHoldSpeed());
  shell.addEventListener('contextmenu',e=>{if(holdSpeed||holdTimer)e.preventDefault()});
  playBtn.addEventListener('click',e=>{e.stopPropagation();video.paused?video.play().catch(()=>{}):video.pause()});$('#swipeBack5')?.addEventListener('click',e=>{e.stopPropagation();if(currentMode!=='direct')return toast('5-second seek is unavailable on this server');video.currentTime=Math.max(0,(video.currentTime||0)-5);setChrome(true)});
  $('#swipeForward5')?.addEventListener('click',e=>{e.stopPropagation();if(currentMode!=='direct')return toast('5-second seek is unavailable on this server');const end=Number.isFinite(video.duration)?video.duration:Infinity;video.currentTime=Math.min(end,(video.currentTime||0)+5);setChrome(true)});
  progressRange?.addEventListener('pointerdown',e=>{e.stopPropagation();scrubbing=true;releaseHoldSpeed();setChrome(true,true)});
  progressRange?.addEventListener('input',e=>{e.stopPropagation();const dur=Number.isFinite(video.duration)?video.duration:0;if(!dur)return;progressRange.style.setProperty('--progress',`${Number(progressRange.value)/10}%`);if(progressCurrent)progressCurrent.textContent=fmtTime((Number(progressRange.value)/1000)*dur)});
  const commitScrub=e=>{e?.stopPropagation?.();const dur=Number.isFinite(video.duration)?video.duration:0;if(dur&&currentMode==='direct')video.currentTime=(Number(progressRange.value)/1000)*dur;scrubbing=false;updateProgress();setChrome(true)};
  progressRange?.addEventListener('change',commitScrub);progressRange?.addEventListener('pointerup',commitScrub);progressRange?.addEventListener('pointercancel',()=>{scrubbing=false;updateProgress()});
  $('#swipeClose')?.addEventListener('click',e=>{e.stopPropagation();save(true);location.href='/'});
  $('#swipeEpisodesAction')?.addEventListener('click',e=>{e.stopPropagation();renderEpisodeSheet();episodeSheet.showModal();setChrome(true,true)});video.addEventListener('click',()=>{if(holdSpeed||Date.now()<suppressTapUntil)return;setChrome(!shell.classList.contains('controls-visible'))});
  shell.addEventListener('pointermove',()=>{if(shell.classList.contains('controls-visible'))setChrome(true)});shell.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)<42)return;e.preventDefault();navigate(e.deltaY>0?1:-1)},{passive:false});shell.addEventListener('touchstart',e=>{
    const t=e.changedTouches[0];touchY=t?.clientY??null;touchX=t?.clientX??null;
    edgeBack=!shell.classList.contains('landscape-mode')&&touchX!==null&&touchX<=48;edgeBackDx=0;
    if(edgeBack)shell.classList.add('edge-back-active');
  },{passive:true});
  shell.addEventListener('touchmove',e=>{
    if(touchY===null)return;
    const t=e.changedTouches[0];if(!t)return;
    const moveX=t.clientX-(touchX??t.clientX),moveY=t.clientY-touchY;
    const absX=Math.abs(moveX),absY=Math.abs(moveY);
    const intentionalVerticalSwipe=absY>42&&absY>absX*1.18;
    const largeHorizontalEscape=absX>58&&absX>absY*1.15;
    if(intentionalVerticalSwipe||largeHorizontalEscape)releaseHoldSpeed();
    if(edgeBack&&moveX>0&&Math.abs(moveX)>Math.abs(moveY)*1.05){
      edgeBackDx=Math.min(window.innerWidth,moveX);
      shell.style.setProperty('--edge-back-x',`${edgeBackDx}px`);
      e.preventDefault();
    }
  },{passive:false});
  shell.addEventListener('touchend',e=>{
    if(touchY===null)return;
    const t=e.changedTouches[0],y=t?.clientY??touchY,x=t?.clientX??touchX;
    const vertical=touchY-y,right=x-(touchX??x);
    if(edgeBack){
      const shouldReturn=edgeBackDx>=Math.min(110,window.innerWidth*.24)&&Math.abs(right)>Math.abs(vertical)*1.05;
      if(shouldReturn){
        shell.classList.add('edge-back-commit');
        shell.style.setProperty('--edge-back-x','100vw');
        setTimeout(returnToDramaDetails,180);
      }else{
        shell.classList.add('edge-back-reset');
        shell.style.setProperty('--edge-back-x','0px');
        setTimeout(()=>shell.classList.remove('edge-back-active','edge-back-reset'),210);
      }
    }else if(Math.abs(vertical)>65&&Math.abs(vertical)>Math.abs(right)*1.2){
      navigate(vertical>0?1:-1);
    }
    touchY=touchX=null;edgeBack=false;edgeBackDx=0;
  },{passive:true});document.addEventListener('keydown',e=>{if(e.key==='ArrowDown')navigate(1);if(e.key==='ArrowUp')navigate(-1);if(e.key===' '){e.preventDefault();video.paused?video.play():video.pause()}if(e.key==='Escape'){episodeSheet.open&&episodeSheet.close();moreSheet.open&&moreSheet.close();closeReactionTray()}});
  $('#swipeEpisodeTrigger').addEventListener('click',()=>{renderEpisodeSheet();episodeSheet.showModal();setChrome(true,true)});$('#swipeEpisodeTrigger').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();renderEpisodeSheet();episodeSheet.showModal()}});$('#sheetEpisodes').addEventListener('click',e=>{const b=e.target.closest('[data-sheet-index]');if(!b)return;episodeSheet.close();currentSourceIndex=0;loadItem(Number(b.dataset.sheetIndex),true)});$$('[data-sheet-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.sheetClose)?.close()));
  episodeSheet.addEventListener('close',()=>setChrome(true));moreSheet.addEventListener('close',()=>setChrome(true));reportDialog.addEventListener('close',()=>setChrome(true));
  $('#serverButtons')?.addEventListener('click',e=>{const b=e.target.closest('[data-server-index]');if(b)switchServer(Number(b.dataset.serverIndex))});
  landscapeBtn?.addEventListener('click',e=>{e.stopPropagation();toggleLandscape()});
  document.addEventListener('fullscreenchange',syncMediaLayout);document.addEventListener('webkitfullscreenchange',syncMediaLayout);
  $('#swipeMore').addEventListener('click',()=>{moreSheet.showModal();setChrome(true,true)});$('#shuffleBtn').addEventListener('click',()=>{moreSheet.close();const n=Math.floor(Math.random()*feed.length);BBUser?.track?.('surprise_me',{dramaId:feed[n]?.drama_id,metadata:{mode:'unified'}}).catch(()=>{});currentSourceIndex=0;loadItem(n,true)});$('#swipeDonate').addEventListener('click',()=>{moreSheet.close()});
  $('#swipeFavorite').addEventListener('click',async e=>{e.stopPropagation();const item=feed[index];setChrome(true);try{const on=await BBUser.toggleFavorite(item.drama_id,item.slug);renderFavorite();toast(on?'Added to My List':'Removed from My List')}catch(err){toast(err.message)}});$('#swipeReact').addEventListener('click',e=>{e.stopPropagation();setChrome(true,true);const tray=$('#reactionTray'),open=tray.classList.toggle('hidden')===false;$('#swipeReact').setAttribute('aria-expanded',String(open))});
  $('#reactionTray').addEventListener('click',async e=>{const b=e.target.closest('[data-swipe-reaction]');if(!b)return;const item=feed[index],r=b.dataset.swipeReaction;b.disabled=true;burst(r);try{const out=await reactionApi('/rest/v1/rpc/submit_episode_reaction',{p_episode_id:item.episode_id,p_reaction:r,p_bucket_second:Math.floor(video.currentTime||0),p_visitor_token:visitorToken()});const accepted=(Array.isArray(out)?out[0]:out)?.accepted;if(accepted){const c=document.querySelector(`[data-swipe-count="${r}"]`);if(c)c.textContent=String(Number(c.textContent||0)+1);BBUser?.track?.('reaction',{dramaId:item.drama_id,episodeId:item.episode_id,metadata:{reaction:r,mode:'swipe'}}).catch(()=>{});setTimeout(closeReactionTray,350)}else toast('Already reacted here')}catch(err){toast(err.message)}finally{b.disabled=false}});
  window.matchMedia?.('(orientation: landscape)').addEventListener?.('change',syncMediaLayout);
  window.addEventListener('orientationchange',()=>setTimeout(syncMediaLayout,80));
  window.addEventListener('resize',()=>{clearTimeout(syncMediaLayout.t);syncMediaLayout.t=setTimeout(syncMediaLayout,80)});
  $('#swipeShare').addEventListener('click',async e=>{e.stopPropagation();const item=feed[index],data={title:`${item.title} — BingeBox`,text:`Watch ${item.title}`,url:location.href};try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(location.href);toast('Link copied')}BBUser?.track?.('share',{dramaId:item.drama_id,episodeId:item.episode_id,metadata:{mode:'unified'}}).catch(()=>{})}catch{}});$('#swipeStay').addEventListener('click',()=>{autoplayCancelled=true;$('#swipeNextCue').classList.add('hidden');toast('Autoplay cancelled')});

  function openReport(prefill=''){const item=feed[index];if(!item)return;moreSheet.open&&moreSheet.close();$('#swipeReportLabel').textContent=`${item.title} · Episode ${item.episode_number}`;$('#swipeReportStatus').textContent='';if(typeof prefill==='string'&&prefill){$('#swipeReportReason').value='playback';$('#swipeReportDetails').value=`Detected player error: ${prefill}`.slice(0,1000)}reportDialog.showModal()}
  $('#swipeReport').addEventListener('click',()=>openReport());$('#closeSwipeReport').addEventListener('click',()=>reportDialog.close());$('#cancelSwipeReport').addEventListener('click',()=>reportDialog.close());$('#swipeReportForm').addEventListener('submit',async e=>{e.preventDefault();const item=feed[index],st=$('#swipeReportStatus');st.textContent='Sending report…';try{const out=await reactionApi('/rest/v1/rpc/submit_episode_report',{p_episode_id:item.episode_id,p_reason:$('#swipeReportReason').value,p_details:$('#swipeReportDetails').value.trim()||null,p_contact_email:$('#swipeReportEmail').value.trim()||null,p_reporter_token:visitorToken()});st.textContent='Thanks — the report is in our review queue.';$('#swipeReportDetails').value='';setTimeout(()=>reportDialog.close(),850)}catch(err){st.textContent=err.message}});
  window.addEventListener('bb-auth-changed',renderFavorite);loadFeed();
})();

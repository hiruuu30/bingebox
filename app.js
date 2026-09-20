(() => {
  const config = window.BINGEBOX_CONFIG || {};
  let dramas = [];
  let lastFocus = null;
  let trendingIds = [];
  let trendingMeta = new Map();
  let trendingColdStart = true;
  let trendingSignal = {qualified:0,watchMinutes:0,rows:0};
  let heroManualIds = [];
  let heroIndex = 0;
  let heroTimer = null;
  let impressionObserver = null;
  const seenImpressions = new Set();
  let searchTrackTimer = null;
  const episodeCache = new Map();
  const episodeInflight = new Map();
  const progressEpisodeMeta = new Map();

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const formatClock = seconds => {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const grid = $('#posterGrid');
  const allDramaGrid = $('#allDramaGrid');
  const modal = $('#dramaModal');
  const modalPoster = $('#modalPoster');
  const modalTitle = $('#modalTitle');
  const modalGenre = $('#modalGenre');
  const modalDesc = $('#modalDesc');
  const modalEpisodes = $('#modalEpisodes');
  const modalDuration = $('#modalDuration');
  const modalEpisodeList = $('#modalEpisodeList');
  const availabilityNote = $('#availabilityNote');
  const search = $('#searchOverlay');
  const searchInput = $('#searchInput');
  const searchResultsEl = $('#searchResults');
  const toast = $('#toast');
  const filters = $('#filters');
  const allDramaPagination = $('#allDramaPagination');
  const allDramaPageStatus = $('#allDramaPageStatus');
  const allDramaPrev = $('#allDramaPrev');
  const allDramaNext = $('#allDramaNext');
  const ALL_DRAMA_PAGE_SIZE = 30;
  let allDramaPage = 1;
  let allDramaFilter = 'all';
  let allDramaExpanded = true;

  const watchUrl = (drama, ep = 1) => `/watch?drama=${encodeURIComponent(drama.id)}&ep=${encodeURIComponent(ep)}`;
  const requestedDrama = () => {
    try { return new URLSearchParams(location.search).get('drama') || ''; }
    catch { return ''; }
  };


  async function fetchAllRows(url, headers, pageSize = 1000) {
    const out = [];
    let offset = 0;
    while (true) {
      const sep = url.includes('?') ? '&' : '?';
      const res = await fetch(`${url}${sep}limit=${pageSize}&offset=${offset}`, { headers });
      if (!res.ok) throw new Error('The catalog is temporarily unavailable.');
      const batch = await res.json();
      out.push(...batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
    return out;
  }

  async function fetchJSON(url, headers, message='The catalog is temporarily unavailable.') {
    const res = await fetch(url, { headers, cache:'no-store' });
    if (!res.ok) throw new Error(message);
    return res.json();
  }

  function applyEpisodeList(d, list=[]) {
    const sorted=[...(list||[])].sort((a,b)=>Number(a.episode_number)-Number(b.episode_number));
    d.episodeItems=sorted;
    d.episodes=Math.max(Number(d.episodes||0), sorted.length);
    d.latestEpisodeAt=sorted.map(ep=>ep.updated_at||ep.created_at||ep.publish_at).filter(Boolean).sort().at(-1)||d.latestEpisodeAt||null;
    episodeCache.set(d.dbId, sorted);
    sorted.forEach(ep=>progressEpisodeMeta.set(ep.id,ep));
    return sorted;
  }

  async function loadDramaEpisodes(d,{force=false}={}) {
    if(!d?.dbId||!config.supabaseUrl||!config.supabasePublishableKey)return [];
    if(!force&&episodeCache.has(d.dbId))return applyEpisodeList(d,episodeCache.get(d.dbId));
    if(!force&&episodeInflight.has(d.dbId))return episodeInflight.get(d.dbId);
    const base=config.supabaseUrl.replace(/\/$/,'');
    const headers={apikey:config.supabasePublishableKey,Accept:'application/json'};
    const task=fetchJSON(`${base}/rest/v1/episodes?published=eq.true&drama_id=eq.${encodeURIComponent(d.dbId)}&select=id,drama_id,episode_number,title,duration_seconds,video_key,video_url,created_at,updated_at,publish_at&order=episode_number.asc`,headers)
      .then(rows=>applyEpisodeList(d,rows))
      .finally(()=>episodeInflight.delete(d.dbId));
    episodeInflight.set(d.dbId,task);
    return task;
  }

  async function loadProgressEpisodeMetadata() {
    if(!BBUser?.getState?.().signedIn||!config.supabaseUrl||!config.supabasePublishableKey)return;
    const rows=(BBUser.getProgressRows?.()||[]).slice(0,60);
    const ids=[...new Set(rows.map(r=>r.episode_id).filter(Boolean))].filter(id=>!progressEpisodeMeta.has(id));
    if(!ids.length)return;
    const base=config.supabaseUrl.replace(/\/$/,'');
    const headers={apikey:config.supabasePublishableKey,Accept:'application/json'};
    for(let i=0;i<ids.length;i+=60){
      const chunk=ids.slice(i,i+60);
      const meta=await fetchJSON(`${base}/rest/v1/episodes?id=in.(${chunk.join(',')})&published=eq.true&select=id,drama_id,episode_number,title,duration_seconds`,headers).catch(()=>[]);
      (meta||[]).forEach(ep=>progressEpisodeMeta.set(ep.id,ep));
    }
  }

  async function loadCatalog() {
    try {
      if (config.backendMode !== 'supabase' || !config.supabaseUrl || !config.supabasePublishableKey) {
        throw new Error('The live catalog is not connected.');
      }
      const base = config.supabaseUrl.replace(/\/$/, '');
      const headers = { apikey: config.supabasePublishableKey, Accept: 'application/json' };

      // v24.7: Home never downloads the full episode library. Episode counts come
      // with the drama rows; episode metadata is fetched only when a title is opened.
      const dramaPromise = fetch(`${base}/rest/v1/dramas?published=eq.true&select=id,slug,title,genre,mood,description,poster_url,featured,sort_order,created_at,updated_at,is_complete,publish_at,is_r18,published_episode_stats:episodes(count)&episodes.published=eq.true&order=sort_order.asc,created_at.desc`, { headers });
      const heroSettingPromise = fetch(`${base}/rest/v1/site_settings?key=eq.hero_highlight_ids&select=value`, { headers, cache:'no-store' }).catch(()=>null);

      const dramaRes = await dramaPromise;
      if (!dramaRes.ok) throw new Error('The catalog is temporarily unavailable.');
      const rows = await dramaRes.json();
      dramas = rows.map(d => ({
        id: d.slug, dbId: d.id, title: d.title, genre: d.genre, mood: d.mood || [],
        description: d.description || '', poster: d.poster_url || '/assets/brand/mark.svg',
        episodes: Math.max(0, Number(d.published_episode_stats?.[0]?.count || 0)), featured: d.featured, isComplete: !!d.is_complete, isR18: !!d.is_r18,
        publishAt: d.publish_at || null, createdAt: d.created_at || null, updatedAt: d.updated_at || null,
        latestEpisodeAt: null, episodeItems: []
      }));

      // Paint immediately. This intentionally happens before episode pagination,
      // account sync, analytics ranking and other non-visual startup work.
      renderFilters();
      renderCatalog();
      renderSearch('');
      renderHero();
      renderGenreRows();

      const heroSettingRes = await heroSettingPromise;
      heroManualIds=[];
      if(heroSettingRes?.ok){
        try{
          const settingRows=await heroSettingRes.json();
          const parsed=JSON.parse(settingRows?.[0]?.value||'[]');
          if(Array.isArray(parsed)) heroManualIds=parsed.map(String).filter(Boolean).slice(0,3);
        }catch{}
      }
      if (window.BBUser) {
        await BBUser.ready;
        await BBUser.mergeLocalState(dramas).catch(()=>{});
        await loadProgressEpisodeMetadata().catch(()=>{});
      }
      await loadTrending();
      renderFilters();
      renderCatalog();
      renderSearch('');
      renderHero();
      renderContinueWatching();
      renderMyList();
      renderForYou();
      renderNewUpdated();
      renderGenreRows();
      renderWatchHistory();
      observeCatalogImpressions();
      const requested=requestedDrama();
      if(requested){
        requestAnimationFrame(()=>{
          const d=dramas.find(x=>x.id===requested||x.dbId===requested);
          if(d){ openDrama(d.id); setMobileTab('discover'); history.replaceState(null,'',`${location.pathname}#discover`); }
        });
      }
      BBUser?.track?.('home_view').catch(()=>{});
    } catch (error) {
      console.error(error);
      dramas = [];
      if (grid) {
        grid.classList.remove('is-loading'); grid.setAttribute('aria-busy','false');
        grid.innerHTML = '<div class="catalog-error"><strong>Catalog temporarily unavailable.</strong><span>Please try again in a moment.</span><button type="button" id="retryCatalog">Retry</button></div>';
        $('#retryCatalog')?.addEventListener('click', loadCatalog);
      }
      $('#heroStage')?.classList.add('hidden'); $('#featured')?.classList.add('hidden');
    }
  }

  function optimizedPoster(url, width = 390, height = 585, quality = 78) {
    const raw=String(url||'');
    if(!raw || raw.startsWith('data:')) return raw;
    // v24.3 reliability hotfix: use the canonical media URL as the primary source.
    // The previous Netlify Image CDN transform path was returning broken images
    // for production poster URLs, which delayed paint and exposed browser ? icons.
    // Keep width/height/priority hints on <img>; re-enable transforms only after
    // the remote media origin is verified compatible with Netlify Image CDN.
    return raw;
  }


function posterCard(d, rank = 0, cleanPoster = false, priority = false) {
  const title = escapeHTML(d.title);
  const genre = escapeHTML(d.genre || 'Drama');
  const poster = escapeHTML(optimizedPoster(d.poster));
  const epLabel = d.episodes ? `${d.episodes} Episode${d.episodes === 1 ? '' : 's'}` : 'Coming Soon';
  const resume = getResumeState(d);
  const duration = Number(resume?.ep?.duration_seconds || 0);
  const hasMeaningfulProgress = Boolean(resume && Number(resume.seconds || 0) > 5);
  const pct = hasMeaningfulProgress && duration ? Math.max(2, Math.min(98, Math.round((resume.seconds / duration) * 100))) : 0;
  const progressUI = pct ? `<span class="poster-progress" aria-hidden="true"><i style="width:${pct}%"></i></span>` : '';
  const resumeKind = resume?.freshNext || !hasMeaningfulProgress ? 'NEXT' : 'RESUME';
  const resumeEpLabel = resume ? String(resume.ep.episode_number).padStart(2,'0') : '';
  const resumeUI = resume ? `<span class="catalog-resume ${resumeKind === 'NEXT' ? 'is-next' : ''}">${resumeKind} · EP ${resumeEpLabel}</span>` : '';
  const favorite = BBUser?.isFavorite?.(d.dbId,d.id);
  const statusBadge = d.discoveryLabel ? `<span class="poster-update-badge">${escapeHTML(d.discoveryLabel)}</span>` : (d.isComplete ? '<span class="poster-complete">COMPLETE</span>' : '');
  const favoriteButton = `<button class="poster-favorite ${favorite?'active':''}" type="button" data-favorite="${escapeHTML(d.id)}" aria-label="${favorite?'Remove from':'Add to'} My List" aria-pressed="${favorite?'true':'false'}">${favorite?'✓':'＋'}</button>`;
  const description=escapeHTML((d.description||'').trim() || 'Watch this short drama on BingeBox.');
  const watchHref=watchUrl(d, Math.max(1,Number(resume?.ep?.episode_number||1)));
  return `<article class="poster-card bbx-book-card ${rank >= 0 ? `ranked-card` : ``} ${cleanPoster ? `clean-poster-card` : ``}" tabindex="0" role="button" data-open="${escapeHTML(d.id)}" aria-label="Open ${title}">
    <div class="bbx-local-backdrop" aria-hidden="true"><div class="bbx-background-cover"><img src="${poster}" alt=""></div><div class="bbx-blur-mask"></div></div>
    <div class="poster-visual"><img src="${poster}" alt="${title} poster" loading="${priority?'eager':'lazy'}" fetchpriority="${priority?'high':'auto'}" decoding="async" width="600" height="800" />
      <div class="poster-badge-stack">${rank >= 0 ? `<span class="poster-trending-badge"><b>#${rank+1}</b><span>TRENDING NOW</span></span>` : ''}${d.isR18 ? '<span class="poster-r18">R18</span>' : ''}${statusBadge}</div>${favoriteButton}${progressUI}
    </div>
    <div class="bbx-book-meta">${resumeUI}<h3>${title}</h3><p><span>${genre}</span><i>｜</i><span>${escapeHTML(epLabel)}</span></p></div>
    <div class="bbx-local-foreground">
      <div class="bbx-hover-cover"><img src="${poster}" alt=""></div>
      <div class="bbx-hover-details"><strong>${title}</strong><span class="bbx-hover-meta">${genre} ｜ ${escapeHTML(epLabel)}</span><p>${description}</p>
        <div class="bbx-hover-actions"><a class="bbx-hover-play" href="${watchHref}" data-hover-play="${escapeHTML(d.id)}" aria-label="Play ${title}">▶</a><button type="button" class="bbx-hover-icon ${favorite?'active':''}" data-favorite="${escapeHTML(d.id)}" aria-label="${favorite?'Remove from':'Add to'} My List">${favorite?'✓':'▮'}</button><button type="button" class="bbx-hover-icon" data-share="${escapeHTML(d.id)}" aria-label="Share ${title}">↗</button></div>
      </div>
    </div>
  </article>`;
}

  function freshnessScore(d){
    const stamp=Math.max(
      new Date(d.latestEpisodeAt||0).getTime()||0,
      new Date(d.updatedAt||0).getTime()||0,
      new Date(d.createdAt||0).getTime()||0
    );
    if(!stamp)return 0;
    const days=Math.max(0,(Date.now()-stamp)/86400000);
    return Math.max(0,1-Math.min(days,45)/45);
  }

  function coldStartTrendingScore(d){
    const row=trendingMeta.get(d.dbId)||{};
    const analytics=Math.log1p(Math.max(0,Number(row.score||0)));
    const qualified=Math.log1p(Math.max(0,Number(row.qualified_viewers??row.qualified??0)));
    const fresh=freshnessScore(d);
    return analytics*.32+qualified*.42+fresh*2.15;
  }

  function trendingOrder(){
    if(!trendingColdStart){
      const ranked=trendingIds.map(id=>dramas.find(d=>d.dbId===id)).filter(Boolean);
      return [...ranked,...dramas.filter(d=>!trendingIds.includes(d.dbId))];
    }
    return [...dramas].sort((a,b)=>coldStartTrendingScore(b)-coldStartTrendingScore(a));
  }

  function heroSelection(){
    const ranked=trendingOrder();
    if(!heroManualIds.length) return ranked.slice(0,8);
    const manual=heroManualIds.map(id=>dramas.find(d=>String(d.dbId)===String(id)||d.id===id)).filter(Boolean);
    const used=new Set(manual.map(d=>String(d.dbId)));
    return [...manual,...ranked.filter(d=>!used.has(String(d.dbId)))].slice(0,8);
  }

  async function loadTrending(){
    trendingIds=[];trendingMeta=new Map();trendingColdStart=true;trendingSignal={qualified:0,watchMinutes:0,rows:0};
    if(!config.supabaseUrl||!config.supabasePublishableKey)return;
    try{
      const base=config.supabaseUrl.replace(/\/$/,'');
      const res=await fetch(`${base}/rest/v1/rpc/get_bingebox_trending`,{method:'POST',headers:{apikey:config.supabasePublishableKey,'Content-Type':'application/json',Accept:'application/json',...(BBUser?.getAuthHeader?.()||{})},body:JSON.stringify({p_hours:72,p_limit:10}),cache:'no-store'});
      if(!res.ok)return;
      const rows=await res.json();
      const list=Array.isArray(rows)?rows:[];
      let qualified=0,watchMinutes=0;
      for(const row of list){
        trendingIds.push(row.drama_id);
        trendingMeta.set(row.drama_id,row);
        qualified+=Number(row.qualified_viewers??row.qualified??0)||0;
        watchMinutes+=Number(row.measured_watch_minutes??row.watch_minutes??0)||0;
      }
      const recentPlays=list.reduce((sum,row)=>sum+Math.max(0,Number(row.score||0)),0);
      trendingSignal={qualified,watchMinutes,rows:list.length,recentPlays};
      trendingColdStart=recentPlays<=0;
    }catch{}
  }

  function renderCatalog(filter = allDramaFilter) {
    allDramaFilter = filter || 'all';
    if (grid) {
      const trending=trendingOrder().slice(0,10);
      grid.classList.remove('is-loading');
      grid.setAttribute('aria-busy','false');
      grid.innerHTML = trending.map((d,i)=>`<div class="top10-item" data-rank="${i+1}"><span class="top10-rank" aria-hidden="true">${i+1}</span>${posterCard(d,-1,false,i<6)}</div>`).join('') || '<p class="empty-state">No dramas yet.</p>';
    }
    if (allDramaGrid) {
      const items = allDramaFilter === '__favorites__'
        ? dramas.filter(d => BBUser?.isFavorite?.(d.dbId,d.id))
        : dramas.filter(d => allDramaFilter === 'all' || d.genre === allDramaFilter);
      const pageSize = ALL_DRAMA_PAGE_SIZE;
      const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
      allDramaPage = Math.min(Math.max(1, allDramaPage), totalPages);
      const start = (allDramaPage - 1) * pageSize;
      const pageItems = items.slice(start, start + pageSize);
      allDramaGrid.innerHTML = pageItems.map(d => posterCard(d, -1, true)).join('') || `<p class="empty-state">${allDramaFilter==='__favorites__'?'Your My List is empty. Save a drama and it will appear here.':'No dramas in this category yet.'}</p>`;
      if (allDramaPagination) {
        const hasMultiplePages = totalPages > 1;
        allDramaPagination.classList.toggle('hidden', !hasMultiplePages);
        if (allDramaPageStatus) {
          const from = items.length ? start + 1 : 0;
          const to = Math.min(start + pageItems.length, items.length);
          allDramaPageStatus.textContent = items.length ? `${from}–${to} of ${items.length}` : '0 titles';
        }
        if (allDramaPrev) allDramaPrev.disabled = allDramaPage <= 1;
        if (allDramaNext) allDramaNext.disabled = allDramaPage >= totalPages;
      }
    }
    setTimeout(observeCatalogImpressions,0);
  }

  function renderFilters() {
    if (!filters) return;
    const genres = [...new Set(dramas.map(d => d.genre).filter(Boolean))].sort();
    filters.innerHTML = ['all', ...genres].map((genre, i) => `<button class="${i === 0 ? 'active' : ''}" type="button" role="tab" aria-selected="${i === 0}" data-filter="${escapeHTML(genre)}">${genre === 'all' ? 'All' : escapeHTML(genre.charAt(0).toUpperCase() + genre.slice(1))}</button>`).join('');
  }

  function setHeroCard(el, d) {
    if (!el) return;
    if (!d) { el.classList.add('hidden'); el.removeAttribute('data-open'); return; }
    const img = $('img', el);
    img.src = d.poster;
    img.alt = `${d.title} poster`;
    el.dataset.open = d.id;
    el.setAttribute('aria-label', `Open ${d.title}`);
    el.classList.remove('hidden');
  }

  async function mountHeroHighlight(featured){
    const clip=$('#heroHighlightVideo'),label=$('#heroHighlightLabel'),stage=$('#heroStage');
    if(!clip)return;
    const reset=()=>{clip.pause();clip.removeAttribute('src');clip.removeAttribute('data-open');clip.removeAttribute('tabindex');clip.removeAttribute('role');clip.setAttribute('aria-hidden','true');clip.classList.add('hidden');label?.classList.add('hidden');stage?.classList.remove('highlight-active')};
    reset();
    if(!featured?.episodeItems?.length||!config.supabaseUrl)return;
    try{
      const ep=featured.episodeItems[0],base=config.supabaseUrl.replace(/\/$/,'');
      const headers={apikey:config.supabasePublishableKey,Accept:'application/json'};
      const sr=await fetch(`${base}/rest/v1/episode_sources?episode_id=eq.${ep.id}&active=eq.true&source_type=neq.embed&select=provider,source_type,source_url,priority&order=priority.asc&limit=1`,{headers,cache:'no-store'});
      const rows=sr.ok?await sr.json():[];const src=rows?.[0];let url='';
      if(src?.source_url&&src.provider!=='legacy_r2')url=src.source_url;
      else if(ep.video_key){const endpoint=config.secureMediaEndpoint||'/api/stream';const rr=await fetch(`${endpoint}?key=${encodeURIComponent(ep.video_key)}`,{headers:{Accept:'application/json'},cache:'no-store'});const data=await rr.json().catch(()=>({}));if(rr.ok)url=data.url||''}
      else url=src?.source_url||ep.video_url||'';
      if(!url)return;
      clip.poster=featured.poster||'';clip.src=url;clip.dataset.open=featured.id;clip.setAttribute('role','button');clip.setAttribute('tabindex','0');clip.setAttribute('aria-label',`Open ${featured.title}`);clip.setAttribute('aria-hidden','false');clip.load();
      const hideClip=()=>{clip.removeAttribute('data-open');clip.removeAttribute('tabindex');clip.removeAttribute('role');clip.setAttribute('aria-hidden','true');clip.classList.add('hidden');label?.classList.add('hidden');stage?.classList.remove('highlight-active')};
      const onMeta=()=>{
        const duration=Number(clip.duration||0);const start=duration>30?Math.min(12,Math.max(3,duration*.12)):0;
        try{clip.currentTime=start}catch{}
        clip.dataset.clipStart=String(start);clip.dataset.clipEnd=String(duration?Math.min(duration-.25,start+8):8);
        clip.classList.remove('hidden');label?.classList.remove('hidden');stage?.classList.add('highlight-active');clip.play().catch(hideClip);
      };
      clip.onloadedmetadata=onMeta;clip.ontimeupdate=()=>{const end=Number(clip.dataset.clipEnd||0),start=Number(clip.dataset.clipStart||0);if(end&&clip.currentTime>=end){clip.currentTime=start;clip.play().catch(()=>{})}};
      clip.onerror=hideClip;
    }catch{reset()}
  }

  function heroItems(){
    const primary=heroSelection();
    const ranked=trendingOrder();
    const seen=new Set();
    return [...primary,...ranked,...dramas].filter(d=>{
      if(!d||seen.has(d.id))return false;
      seen.add(d.id);return true;
    }).slice(0,8);
  }

  function renderHero(index = heroIndex) {
    const stage = $('#heroStage');
    if (!stage) return;
    const items=heroItems();
    if (!items.length) { stage.classList.add('hidden'); return; }
    heroIndex=((index%items.length)+items.length)%items.length;
    const featured=items[heroIndex];
    const backdrop=$('#heroBackdrop'),poster=$('#heroPoster'),title=$('#heroTitle'),meta=$('#heroMeta'),desc=$('#heroDescription'),dots=$('#heroDots'),thumbs=$('#heroThumbs');
    const heroImage=optimizedPoster(featured.poster,720,1080,82);
    if(backdrop)backdrop.style.backgroundImage=`url("${String(heroImage||'').replace(/["\\]/g,'')}")`;
    if(poster){poster.loading='eager';poster.fetchPriority='high';poster.decoding='async';poster.width=720;poster.height=1080;poster.src=heroImage;poster.alt='';}
    if(title)title.textContent=featured.title;
    if(meta)meta.innerHTML=`<span class="bbx-hero-pill bbx-hero-pill-hot">${trendingIds.includes(featured.dbId)?'Trending':'Featured'}</span><span class="bbx-hero-pill">${escapeHTML(featured.genre||'Drama')}</span>`;
    if(desc)desc.textContent=featured.description||'Short drama, ready to binge.';
    const btn=$('#heroFeatureButton');
    if(btn){btn.disabled=!featured.episodes;btn.dataset.open=featured.id;$('span',btn).textContent=featured.episodes?'Watch now':'View drama';}
    const fav=$('#heroMyListButton');
    if(fav){const on=BBUser?.isFavorite?.(featured.dbId,featured.id);fav.textContent=on?'✓':'＋';fav.dataset.heroFavorite=featured.id;fav.setAttribute('aria-label',`${on?'Remove':'Add'} ${featured.title} ${on?'from':'to'} My List`);}
    if(dots)dots.innerHTML=items.map((d,i)=>`<button type="button" class="bbx-hero-dot ${i===heroIndex?'active':''}" data-hero-index="${i}" role="tab" aria-selected="${i===heroIndex}" aria-label="Show ${escapeHTML(d.title)}"></button>`).join('');
    if(thumbs)thumbs.innerHTML=items.map((d,i)=>`<button type="button" class="bbx-hero-thumb ${i===heroIndex?'active':''}" data-hero-index="${i}" aria-label="Show ${escapeHTML(d.title)}"><img src="${escapeHTML(optimizedPoster(d.poster,168,224,72))}" alt="" loading="${i<5?'eager':'lazy'}" decoding="async" /><span>${escapeHTML(d.title)}</span></button>`).join('');

    stage.classList.remove('is-loading','hidden');stage.setAttribute('aria-busy','false');
    clearTimeout(heroTimer);
    if(!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches){heroTimer=setTimeout(()=>renderHero(heroIndex+1),6500);}
  }

  function renderGenreRows(){
    const host=$('#genreRows');if(!host)return;
    const ranked=trendingOrder();
    const hay=d=>`${d.title||''} ${d.genre||''} ${(d.mood||[]).join(' ')} ${d.description||''}`.toLowerCase();
    const fill=(test,limit=12)=>{
      const first=ranked.filter(test), out=[], seen=new Set();
      for(const d of [...first,...ranked]){if(!d||seen.has(d.id))continue;seen.add(d.id);out.push(d);if(out.length>=limit)break;}
      return out;
    };
    const shelves=[
      ['Playing Dumb 🦊',d=>/comedy|funny|mistaken|secret|playful|fake|pretend/.test(hay(d))],
      ['Romance & Her 🌹',d=>/romance|love|wife|bride|marriage|girlfriend|her\b/.test(hay(d))],
      ['Heartwarming Love ✨',d=>/heart|family|healing|sweet|warm|love|romance/.test(hay(d))],
      ['Dangerous Love 🔥',d=>/revenge|action|danger|crime|mafia|betray|blood|war/.test(hay(d))],
      ['Alpha & King 👑',d=>/fantasy|alpha|king|royal|billionaire|ceo|heir|lord/.test(hay(d))],
      ['BingeBox Picks 💕',d=>!!d.featured||trendingIds.includes(d.dbId)],
      ['Fan Favorites 🎤',d=>trendingIds.includes(d.dbId)||Number(trendingMeta.get(d.dbId)?.score||0)>0]
    ];
    host.innerHTML=shelves.map(([label,test])=>{
      const items=fill(test,12);
      return `<section class="genre-row" aria-label="${escapeHTML(label)}"><header class="genre-row-head"><h2>${escapeHTML(label)}</h2><a href="#allDrama" class="bb-view-all" data-view-all>View all ›</a></header><div class="genre-row-track">${items.map(d=>posterCard(d,-1,true)).join('')}</div></section>`;
    }).join('');
  }

  function renderFeatured() {
    const section = $('#featured');
    const featured = heroSelection()[0] || dramas[0];
    if (!section || !featured) return;
    $('#featuredPoster').src = featured.poster;
    $('#featuredPoster').alt = `${featured.title} poster`;
    $('#featuredNumber').textContent = String(Math.max(1, dramas.findIndex(d => d.id === featured.id) + 1)).padStart(2,'0');
    $('#featuredTitle').textContent = featured.title;
    $('#featuredDescription').textContent = featured.description || 'Start from episode one and keep the story moving.';
    const button = $('#featuredButton');
    button.dataset.open = featured.id;
    $('span', button).textContent = featured.episodes ? `Watch ${featured.title}` : `View ${featured.title}`;
    section.classList.remove('hidden');
  }


  function readLastWatch(slug) {
    try {
      const raw = localStorage.getItem(`bb-lastwatch:${slug}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function localEpisodeCompleted(drama, ep, seconds = 0, duration = 0) {
    try {
      if (localStorage.getItem(`bb-completed:${drama.id}:${ep.episode_number}`) === '1') return true;
    } catch {}
    return Boolean(duration && seconds >= Math.max(0, duration - 8));
  }

  function getResumeState(d) {
    if(!d||!Number(d.episodes||0))return null;

    if (BBUser?.getState?.().signedIn) {
      const cloudRows=(BBUser.getProgressRows?.()||[])
        .filter(row=>row.drama_id===d.dbId)
        .sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0));
      for(const row of cloudRows){
        const ep=progressEpisodeMeta.get(row.episode_id)||d.episodeItems?.find?.(x=>x.id===row.episode_id);
        if(!ep)continue;
        const seconds=Math.max(0,Number(row.seconds||0));
        const duration=Number(row.duration||ep.duration_seconds||0);
        const completed=Boolean(row.completed||(duration&&seconds>=Math.max(0,duration-8)));
        if(completed){
          const nextNo=Number(ep.episode_number)+1;
          if(nextNo<=Number(d.episodes||0))return {d,ep:{episode_number:nextNo,title:`Episode ${nextNo}`,duration_seconds:0},seconds:0,at:new Date(row.updated_at||0).getTime()||0,freshNext:true,cloud:true};
          return null;
        }
        if(seconds>5)return {d,ep,seconds,at:new Date(row.updated_at||0).getTime()||0,cloud:true};
      }
    }

    const last=readLastWatch(d.id);
    if(last?.episode){
      const ep=d.episodeItems?.find?.(e=>Number(e.episode_number)===Number(last.episode))||{episode_number:Number(last.episode),title:`Episode ${Number(last.episode)}`,duration_seconds:Number(last.duration||0)};
      const seconds=Math.max(0,Number(last.time||0));
      const duration=Number(ep.duration_seconds||last.duration||0);
      const completed=Boolean(last.completed||localEpisodeCompleted(d,ep,seconds,duration));
      if(completed){
        const nextNo=Number(ep.episode_number)+1;
        if(nextNo<=Number(d.episodes||0))return {d,ep:{episode_number:nextNo,title:`Episode ${nextNo}`,duration_seconds:0},seconds:0,at:Number(last.at||0),freshNext:true};
        return null;
      }
      if(seconds>5)return {d,ep,seconds,at:Number(last.at||0)};
    }

    // Legacy fallback is only attempted for a drama whose episodes have already
    // been loaded on demand. This avoids a full-library request just for old local keys.
    if(d.episodeItems?.length){
      for(const ep of [...d.episodeItems].reverse()){
        let seconds=0;try{seconds=Number(localStorage.getItem(`bb-progress:${d.id}:${ep.episode_number}`)||0)}catch{}
        const duration=Number(ep.duration_seconds||0);
        if(localEpisodeCompleted(d,ep,seconds,duration))continue;
        if(seconds>5)return {d,ep,seconds,at:0};
      }
    }
    return null;
  }

  function renderContinueWatching() {
    const section = $('#continueWatching');
    const host = $('#continueCard');
    if(section)section.classList.add('hidden');
    if(host)host.innerHTML='';
  }

  function renderMyList() {
    const section=$('#myListSection');
    const host=$('#myListGrid');
    if(section)section.classList.add('hidden');
    if(host)host.innerHTML='';
  }

  function historyEntries(){
    const out=[];
    if(BBUser?.getState?.().signedIn){
      for(const row of BBUser.getProgressRows?.()||[]){
        const d=dramas.find(x=>x.dbId===row.drama_id);
        const ep=progressEpisodeMeta.get(row.episode_id)||d?.episodeItems?.find?.(x=>x.id===row.episode_id);
        if(d&&ep)out.push({d,ep,seconds:Number(row.seconds||0),duration:Number(row.duration||ep.duration_seconds||0),completed:!!row.completed,at:new Date(row.updated_at||0).getTime()||0});
      }
    }else{
      for(const d of dramas){
        const last=readLastWatch(d.id);if(!last?.episode)continue;
        const ep=d.episodeItems?.find?.(x=>Number(x.episode_number)===Number(last.episode))||{episode_number:Number(last.episode),title:`Episode ${Number(last.episode)}`,duration_seconds:Number(last.duration||0)};
        out.push({d,ep,seconds:Number(last.time||0),duration:Number(last.duration||ep.duration_seconds||0),completed:!!last.completed,at:Number(last.at||0)});
      }
    }
    return out.sort((a,b)=>b.at-a.at).slice(0,20);
  }

  function renderWatchHistory(){
    const host=$('#accountHistoryList'),count=$('#accountHistoryCount');if(!host||!count)return;
    const rows=historyEntries();count.textContent=String(rows.length);
    host.innerHTML=rows.length?rows.slice(0,12).map(x=>{const pct=x.duration?Math.min(100,Math.round(x.seconds/x.duration*100)):0;return `<a class="history-row" href="${watchUrl(x.d,x.ep.episode_number)}"><img src="${escapeHTML(x.d.poster)}" alt="" loading="lazy"><span><strong>${escapeHTML(x.d.title)}</strong><small>EP ${String(x.ep.episode_number).padStart(2,'0')} · ${x.completed?'Watched':pct?`${pct}% watched`:'Started'}</small></span><b>→</b></a>`}).join(''):'<p class="history-empty">Your recent episodes will appear here.</p>';
  }

  function recommendationScore(d,history,genreWeight,moodWeight,confidence=1){
    const trend=Number(trendingMeta.get(d.dbId)?.score||0);
    let personal=(genreWeight.get(d.genre)||0)*3;
    for(const mood of d.mood||[])personal+=(moodWeight.get(mood)||0)*1.2;
    if(BBUser?.isFavorite?.(d.dbId,d.id))personal+=4;
    const discovery=Math.log1p(Math.max(0,trend))*1.05+freshnessScore(d)*2.2+(d.featured?.25:0);
    const recent=history.find(x=>x.d.dbId===d.dbId);
    const repeatPenalty=recent?(recent.completed?5:2):0;
    return personal*confidence+discovery*(1-confidence*.52)-repeatPenalty;
  }

  function renderForYou(){
    const section=$('#forYouSection'),host=$('#forYouGrid');if(!section||!host)return;
    const stamp=d=>Math.max(new Date(d.publishAt||0).getTime()||0,new Date(d.createdAt||0).getTime()||0,new Date(d.updatedAt||0).getTime()||0);
    const items=[...dramas].sort((a,b)=>stamp(b)-stamp(a)).slice(0,12).map(d=>({...d,discoveryLabel:'NEW'}));
    if(!items.length){section.classList.add('hidden');host.innerHTML='';return}
    host.innerHTML=items.map(d=>posterCard(d,-1,true)).join('');section.classList.remove('hidden');
  }

  function renderNewUpdated(){
    const section=$('#newUpdatedSection'),host=$('#newUpdatedGrid');if(!section||!host)return;
    const ranked=trendingOrder(), preferred=dramas.filter(d=>d.featured), out=[], seen=new Set();
    for(const d of [...preferred,...ranked]){if(!d||seen.has(d.id))continue;seen.add(d.id);out.push(d);if(out.length>=12)break;}
    if(!out.length){section.classList.add('hidden');host.innerHTML='';return}
    host.innerHTML=out.map(d=>posterCard(d,-1,true)).join('');section.classList.remove('hidden');
  }

  function observeCatalogImpressions(){
    impressionObserver?.disconnect?.();if(!('IntersectionObserver'in window))return;
    impressionObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting||entry.intersectionRatio<.55)continue;const card=entry.target,id=card.dataset.open,d=dramas.find(x=>x.id===id);if(!d)continue;const section=card.closest('section')?.id||'catalog',key=`${section}:${d.dbId}`;if(seenImpressions.has(key))continue;seenImpressions.add(key);BBUser?.track?.('catalog_impression',{dramaId:d.dbId,metadata:{section}}).catch(()=>{});impressionObserver.unobserve(card)}},{threshold:[.55]});
    $$('.poster-card[data-open]').forEach(card=>impressionObserver.observe(card));
  }

  function updateDramaSEO(d){
    if(!d)return;
    const cleanDesc=String(d.description||`Watch ${d.title} free on BingeBox.`).replace(/\s+/g,' ').trim().slice(0,155);
    const pageUrl=`${location.origin}/?drama=${encodeURIComponent(d.id)}`;
    const image=(()=>{try{return new URL(d.poster,location.origin).href}catch{return `${location.origin}/assets/social/og-cover.jpg`}})();
    document.title=`${d.title} — Watch Free Short Drama | BingeBox`;
    const set=(sel,attr,value)=>{const el=document.querySelector(sel);if(el)el.setAttribute(attr,value)};
    set('meta[name="description"]','content',cleanDesc);set('link[rel="canonical"]','href',pageUrl);
    set('meta[property="og:title"]','content',`${d.title} | BingeBox`);set('meta[property="og:description"]','content',cleanDesc);set('meta[property="og:url"]','content',pageUrl);set('meta[property="og:image"]','content',image);
    set('meta[name="twitter:title"]','content',`${d.title} | BingeBox`);set('meta[name="twitter:description"]','content',cleanDesc);set('meta[name="twitter:image"]','content',image);
    let schema=document.querySelector('#dramaStructuredData');if(!schema){schema=document.createElement('script');schema.type='application/ld+json';schema.id='dramaStructuredData';document.head.appendChild(schema)}
    schema.textContent=JSON.stringify({'@context':'https://schema.org','@type':'TVSeries',name:d.title,description:cleanDesc,image:[image],url:pageUrl,genre:d.genre||undefined,numberOfEpisodes:Number(d.episodes)||undefined,inLanguage:'en',isFamilyFriendly:!d.isR18,publisher:{'@id':'https://bingebox.bond/#organization'}});
    try{const u=new URL(location.href);u.searchParams.set('drama',d.id);history.replaceState(history.state,'',u.pathname+u.search+u.hash)}catch{}
  }

  function resetHomeSEO(){
    document.title='Watch Free Short Dramas Online | BingeBox';
    const set=(sel,attr,value)=>{const el=document.querySelector(sel);if(el)el.setAttribute(attr,value)};
    const desc='Watch free short dramas online on BingeBox — romance, revenge, fantasy, action and more. Built for viewers in the US, Australia, Canada and the Philippines.';
    set('meta[name="description"]','content',desc);set('link[rel="canonical"]','href','https://bingebox.bond/');set('meta[property="og:title"]','content','Watch Free Short Dramas Online | BingeBox');set('meta[property="og:description"]','content','Binge-worthy short dramas you can watch free online. Big drama. One little box.');set('meta[property="og:url"]','content','https://bingebox.bond/');
    document.querySelector('#dramaStructuredData')?.remove();
    try{history.replaceState(history.state,'',location.pathname+location.hash)}catch{}
  }

  function renderModalEpisodeDetails(d){
    const list=d.episodeItems||[];
    const totalSeconds=list.reduce((sum,ep)=>sum+Number(ep.duration_seconds||0),0);
    modalDuration.textContent=totalSeconds?`${Math.max(1,Math.round(totalSeconds/60))} min total`:'Short-form';
    const fresh=$('#modalFreshness');if(fresh){const stamp=Math.max(new Date(d.updatedAt||0).getTime()||0,new Date(d.latestEpisodeAt||0).getTime()||0);fresh.textContent=stamp?`Updated ${new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(new Date(stamp))}`:'';}
    modalEpisodeList.innerHTML=list.length?list.map(ep=>{
      const cloud=BBUser?.getProgress?.(ep.id);const seconds=Number(cloud?.seconds||readProgress(d.id,ep.episode_number)||0),duration=Number(cloud?.duration||ep.duration_seconds||0);
      let completed=!!cloud?.completed;try{completed=completed||localStorage.getItem(`bb-completed:${d.id}:${ep.episode_number}`)==='1'}catch{}
      const pct=duration?Math.min(100,Math.round(seconds/duration*100)):0;
      return `<a href="${watchUrl(d,ep.episode_number)}" class="modal-episode-chip ${completed?'watched':pct>2?'in-progress':''}"><span>EP ${String(ep.episode_number).padStart(2,'0')}</span><strong>${escapeHTML(ep.title||`Episode ${ep.episode_number}`)}</strong><small>${completed?'Watched':pct>2?`${pct}%`:'Play'}</small>${pct?`<i><b style="width:${pct}%"></b></i>`:''}</a>`;
    }).join(''):'<p class="history-empty">No published episodes yet.</p>';
  }

  async function openDrama(id) {
    const d=dramas.find(item=>item.id===id);
    if(!d||!modal)return;
    updateDramaSEO(d);
    lastFocus=document.activeElement;
    modalPoster.src=d.poster;modalPoster.alt=`${d.title} poster`;
    $('#modalAmbient')?.style.setProperty('--detail-art',`url("${String(d.poster).replace(/["\\]/g,'')}")`);
    modalTitle.textContent=d.title;modalGenre.textContent=`${String(d.genre||'Drama').toUpperCase()} · ON BINGEBOX`;modalDesc.textContent=d.description;
    modalEpisodes.textContent=d.episodes?`${d.episodes} episode${d.episodes===1?'':'s'}`:'Episodes coming soon';
    modalDuration.textContent=d.episodes?'Loading episode details…':'Short-form';
    $('#modalCompleteBadge')?.classList.toggle('hidden',!d.isComplete);$('#modalR18Badge')?.classList.toggle('hidden',!d.isR18);
    const favBtn=$('#modalFavoriteBtn');if(favBtn){const fav=BBUser?.isFavorite?.(d.dbId,d.id);favBtn.setAttribute('aria-pressed',String(!!fav));favBtn.classList.toggle('active',!!fav);$('span',favBtn).textContent=fav?'✓':'＋';$('strong',favBtn).textContent=fav?'In My List':'My List';}
    const sourceSection=lastFocus?.closest?.('section')?.id||'unknown';BBUser?.track?.(sourceSection==='forYouSection'?'recommendation_open':'drama_open',{dramaId:d.dbId,metadata:{section:sourceSection}}).catch(()=>{});
    modal.dataset.activeId=d.id;
    const play=$('#playBtn'),playText=$('span',play);
    if(d.episodes){
      play.disabled=false;const resume=getResumeState(d),resumeEp=resume?.ep?.episode_number||1;play.dataset.resumeEp=String(resumeEp);
      if(resume){playText.textContent=resume.seconds>5?`Resume EP ${resumeEp} · ${formatClock(resume.seconds)}`:`Continue episode ${resumeEp}`;availabilityNote.textContent=resume.seconds>5?'Resume from where you left off.':'Continue with the next episode.';}
      else{playText.textContent='Play episode 1';availabilityNote.textContent='Your progress will be saved automatically on this device.';}
      modalEpisodeList.innerHTML='<p class="history-empty">Loading episodes…</p>';
    }else{play.disabled=true;delete play.dataset.resumeEp;playText.textContent='Episodes coming soon';availabilityNote.textContent='No published episodes yet.';modalEpisodeList.innerHTML='';}
    modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.classList.add('lock');setTimeout(()=>$('.modal-close',modal)?.focus(),30);
    if(d.episodes){
      try{await loadDramaEpisodes(d);if(modal.dataset.activeId!==d.id)return;await BBUser?.mergeLocalState?.([d]).catch(()=>{});renderModalEpisodeDetails(d);const resume=getResumeState(d),resumeEp=resume?.ep?.episode_number||1;play.dataset.resumeEp=String(resumeEp);if(resume){playText.textContent=resume.seconds>5?`Resume EP ${resumeEp} · ${formatClock(resume.seconds)}`:`Continue episode ${resumeEp}`;}}
      catch{if(modal.dataset.activeId===d.id){modalDuration.textContent='Short-form';modalEpisodeList.innerHTML='<p class="history-empty">Episode details are temporarily unavailable.</p>';}}
    }
  }

  function readProgress(dramaId, ep) {
    try { return Number(localStorage.getItem(`bb-progress:${dramaId}:${ep}`) || 0); } catch { return 0; }
  }

  function closeModal() {
    if (!modal?.classList.contains('open')) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lock');
    resetHomeSEO();
    lastFocus?.focus?.();
  }

  function openSearch() {
    if (!search) return;
    lastFocus = document.activeElement;
    setMobileTab('search');
    search.classList.add('open');
    search.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lock');
    renderSearch('');
    setTimeout(() => searchInput?.focus(), 60);
  }

  function closeSearch() {
    if (!search?.classList.contains('open')) return;
    search.classList.remove('open');
    search.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lock');
    lastFocus?.focus?.();
    syncMobileTabFromPage();
  }

  function renderSearch(query) {
    if (!searchResultsEl) return;
    const q = query.trim().toLowerCase();
    const items = dramas.filter(d => !q || `${d.title} ${d.genre} ${(d.mood || []).join(' ')}`.toLowerCase().includes(q)).slice(0, 8);
    searchResultsEl.innerHTML = items.length ? items.map(d => `<button class="search-mini" type="button" data-open="${escapeHTML(d.id)}"><img src="${escapeHTML(d.poster)}" alt="" loading="lazy" decoding="async" /><span><h4>${escapeHTML(d.title)}</h4><span>${escapeHTML(d.genre)}</span></span></button>`).join('') : '<p class="empty-state">No matching title yet.</p>';
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
  }


  $('#heroPrev')?.addEventListener('click',()=>renderHero(heroIndex-1));
  $('#heroNext')?.addEventListener('click',()=>renderHero(heroIndex+1));
  $('#heroDots')?.addEventListener('click',e=>{const b=e.target.closest('[data-hero-index]');if(b)renderHero(Number(b.dataset.heroIndex)||0);});
  $('#heroThumbs')?.addEventListener('click',e=>{const b=e.target.closest('[data-hero-index]');if(b)renderHero(Number(b.dataset.heroIndex)||0);});
  {
    const stage=$('#heroStage');let heroDrag=null;
    stage?.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;if(e.target.closest?.('button,a,input,select,textarea,[role=\"button\"]'))return;heroDrag={id:e.pointerId,x:e.clientX,y:e.clientY,t:Date.now()};try{stage.setPointerCapture?.(e.pointerId)}catch{}});
    stage?.addEventListener('pointerup',e=>{if(!heroDrag||heroDrag.id!==e.pointerId)return;const dx=e.clientX-heroDrag.x,dy=e.clientY-heroDrag.y,dt=Date.now()-heroDrag.t;heroDrag=null;try{stage.releasePointerCapture?.(e.pointerId)}catch{};if(Math.abs(dx)>=45&&Math.abs(dx)>Math.abs(dy)*1.25&&dt<900){renderHero(heroIndex+(dx<0?1:-1));}});
    stage?.addEventListener('pointercancel',()=>{heroDrag=null});
  }
  $('#heroMyListButton')?.addEventListener('click',async e=>{
    const id=e.currentTarget.dataset.heroFavorite,d=dramas.find(x=>x.id===id);if(!d)return;
    e.currentTarget.disabled=true;
    try{const on=await BBUser.toggleFavorite(d.dbId,d.id);showToast(on?'Added to My List':'Removed from My List');renderMyList();renderGenreRows();renderForYou();renderNewUpdated();renderCatalog(allDramaFilter);renderHero(heroIndex);}catch(err){showToast(err.message||'Could not update My List.')}
    e.currentTarget.disabled=false;
  });
  $('#genreRows')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-genre-view]');if(!b)return;
    const g=b.dataset.genreView;allDramaExpanded=true;allDramaPage=1;const tab=$(`#filters [data-filter="${CSS.escape(g)}"]`);
    if(tab){tab.click();$('#allDrama')?.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'start'});}
  });

  document.addEventListener('click',e=>{
    const a=e.target.closest('[data-view-all]');
    if(!a)return;
    e.preventDefault();
    allDramaExpanded=true;allDramaPage=1;
    const tab=$('#filters [data-filter="all"]');
    if(tab)tab.click();
    const target=$('#allDrama');
    if(target){
      const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      target.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});
    }
  });

  document.addEventListener('click',event=>{
    const nav=event.target.closest?.('[data-my-list-nav]');if(!nav)return;
    event.preventDefault();allDramaFilter='__favorites__';allDramaPage=1;allDramaExpanded=true;
    $$('#filters [data-filter]').forEach(item=>{item.classList.remove('active');item.setAttribute('aria-selected','false')});
    renderCatalog('__favorites__');
    const target=$('#allDrama');if(target){const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;target.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});}
  });

  filters?.addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    $$('[data-filter]', filters).forEach(item => { item.classList.remove('active'); item.setAttribute('aria-selected', 'false'); });
    button.classList.add('active');
    button.setAttribute('aria-selected', 'true');
    allDramaExpanded = true;
    allDramaPage = 1;
    renderCatalog(button.dataset.filter);
  });

  const moveAllDramaPage = direction => {
    const items = allDramaFilter === '__favorites__'
      ? dramas.filter(d => BBUser?.isFavorite?.(d.dbId,d.id))
      : dramas.filter(d => allDramaFilter === 'all' || d.genre === allDramaFilter);
    const totalPages = Math.max(1, Math.ceil(items.length / ALL_DRAMA_PAGE_SIZE));
    const next = Math.min(totalPages, Math.max(1, allDramaPage + direction));
    if (next === allDramaPage) return;
    allDramaPage = next;
    renderCatalog(allDramaFilter);
    const target = $('#allDrama');
    if (target) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  };
  allDramaPrev?.addEventListener('click', () => moveAllDramaPage(-1));
  allDramaNext?.addEventListener('click', () => moveAllDramaPage(1));

  document.addEventListener('click', async event => {
    const fav=event.target.closest('[data-favorite]');
    if(fav){
      event.preventDefault();event.stopPropagation();
      const d=dramas.find(x=>x.id===fav.dataset.favorite);
      if(d){
        fav.disabled=true;
        try{const on=await BBUser.toggleFavorite(d.dbId,d.id);showToast(on?'Added to My List':'Removed from My List');renderCatalog(allDramaFilter);renderMyList();renderGenreRows();renderForYou();renderNewUpdated();renderHero(heroIndex);}
        catch(err){showToast(err.message||'Could not update My List.')}
        fav.disabled=false;
      }
      return;
    }
    const share=event.target.closest('[data-share]');
    if(share){event.preventDefault();event.stopPropagation();const d=dramas.find(x=>x.id===share.dataset.share);if(d){const url=new URL(watchUrl(d,1),location.origin).href;try{if(navigator.share)await navigator.share({title:d.title,text:`Watch ${d.title} on BingeBox`,url});else{await navigator.clipboard.writeText(url);showToast('Link copied');}}catch{}}return;}
    const cont=event.target.closest('[data-continue-drama]');if(cont)BBUser?.track?.('continue_resume',{dramaId:cont.dataset.continueDrama}).catch(()=>{});
    const opener = event.target.closest('[data-open]');
    if (opener?.dataset.open) {
      if (search?.classList.contains('open')) closeSearch();
      openDrama(opener.dataset.open);
    }
    if (event.target.closest('[data-close]')) closeModal();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeModal(); closeSearch(); }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.poster-card,[data-open][role="button"]')) { event.preventDefault(); openDrama(event.target.dataset.open); }
    if (event.key === '/' && !/input|textarea/i.test(document.activeElement?.tagName || '')) { event.preventDefault(); openSearch(); }
  });

  $('#searchBtn')?.addEventListener('click', openSearch);
  $$('[data-search-trigger]').forEach(button => button.addEventListener('click', openSearch));
  $('#closeSearch')?.addEventListener('click', closeSearch);
  searchInput?.addEventListener('input', event => {renderSearch(event.target.value);clearTimeout(searchTrackTimer);const q=event.target.value.trim();if(q.length>=2)searchTrackTimer=setTimeout(()=>{const n=dramas.filter(d=>`${d.title} ${d.genre} ${(d.mood||[]).join(' ')}`.toLowerCase().includes(q.toLowerCase())).length;BBUser?.track?.(n?'search':'search_zero',{metadata:{query:q.slice(0,80),results:n}}).catch(()=>{})},650);});

  const menu = $('#mobileMenu');
  const menuBtn = $('#menuBtn');
  function setMenu(open) {
    menu?.classList.toggle('open', open);
    menu?.setAttribute('aria-hidden', String(!open));
    menuBtn?.classList.toggle('open', open);
    menuBtn?.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('lock', open);
  }
  menuBtn?.addEventListener('click', () => setMenu(!menu?.classList.contains('open')));
  $$('#mobileMenu a').forEach(link => link.addEventListener('click', () => setMenu(false)));

  $('#playBtn')?.addEventListener('click', event => {
    const active = dramas.find(item => item.id === modal?.dataset.activeId);
    const resumeEp = Math.max(1, Number(event.currentTarget?.dataset?.resumeEp || 1));
    if (active?.episodes) { window.location.href = watchUrl(active, resumeEp); return; }
    showToast('This title does not have a published episode yet.');
  });


  function visitorToken(){
    const key='bb-visitor-token';
    try{
      let value=localStorage.getItem(key);
      if(value) return value;
      value=(crypto.randomUUID?crypto.randomUUID():('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16)})));
      localStorage.setItem(key,value); return value;
    }catch{return crypto.randomUUID?crypto.randomUUID():'00000000-0000-4000-8000-000000000001'}
  }
  const pollBase=(config.supabaseUrl||'').replace(/\/$/,'');
  const pollHeaders={'apikey':config.supabasePublishableKey||'','Content-Type':'application/json','Accept':'application/json'};
  async function pollApi(path,options={}){
    const res=await fetch(`${pollBase}${path}`,{...options,headers:{...pollHeaders,...(options.headers||{})},cache:'no-store'});
    const data=await res.json().catch(()=>null);
    if(!res.ok) throw new Error(data?.message||data?.error||'Request could not be completed.');
    return data;
  }
  let pollMode='top';
  async function loadPoll(){
    const host=$('#requestPollList'); if(!host||!pollBase) return;
    try{
      let rows=await pollApi('/rest/v1/content_requests?status=in.(open,planned,uploaded)&select=id,title,note,status,votes,created_at&order=votes.desc,created_at.asc&limit=50');
      if(pollMode==='fulfilled') rows=rows.filter(r=>r.status==='uploaded').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
      else {
        rows=rows.filter(r=>r.status!=='uploaded');
        if(pollMode==='recent') rows.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
        else if(pollMode==='rising') rows.sort((a,b)=>{
          const ageA=Math.max(1,(Date.now()-new Date(a.created_at))/3600000);
          const ageB=Math.max(1,(Date.now()-new Date(b.created_at))/3600000);
          return (Number(b.votes||0)+1)/Math.pow(ageB,.65)-(Number(a.votes||0)+1)/Math.pow(ageA,.65);
        });
        else rows.sort((a,b)=>Number(b.votes||0)-Number(a.votes||0)||new Date(a.created_at)-new Date(b.created_at));
      }
      rows=rows.slice(0,12);
      host.innerHTML=rows.length?rows.map((r,i)=>{
        const voted=(()=>{try{return localStorage.getItem(`bb-poll-voted:${r.id}`)==='1'}catch{return false}})();
        const label=r.status==='planned'?'COMING SOON':r.status==='uploaded'?'ON BINGEBOX':'';
        return `<article class="poll-item"><span class="poll-rank">${String(i+1).padStart(2,'0')}</span><div class="poll-copy"><strong>${escapeHTML(r.title)}</strong>${r.note?`<small>${escapeHTML(r.note)}</small>`:''}${label?`<em>${label}</em>`:''}</div><button type="button" data-poll-vote="${r.id}" ${(voted||r.status==='uploaded')?'disabled':''}><b>${Number(r.votes)||0}</b><span>${r.status==='uploaded'?'Added':voted?'Voted':'Vote'}</span></button></article>`;
      }).join(''):'<div class="poll-empty">No requests yet. Be the first.</div>';
    }catch(err){host.innerHTML=`<div class="poll-empty">${escapeHTML(err.message)}</div>`}
  }
  $('#requestPollForm')?.addEventListener('submit',async e=>{
    e.preventDefault(); const st=$('#requestPollStatus'); st.textContent='Adding your request…';
    try{
      const out=await pollApi('/rest/v1/rpc/submit_content_request',{method:'POST',body:JSON.stringify({p_title:$('#requestTitle').value.trim(),p_note:$('#requestNote').value.trim()||null,p_voter_token:visitorToken()})});
      const row=Array.isArray(out)?out[0]:out; if(row?.request_id){try{localStorage.setItem(`bb-poll-voted:${row.request_id}`,'1')}catch{}}
      $('#requestPollForm').reset(); st.textContent=row?.created?'Added — your vote is included.':'That title was already listed, so your vote was added.'; await loadPoll();
    }catch(err){st.textContent=err.message}
  });
  $('#requestPollList')?.addEventListener('click',async e=>{
    const b=e.target.closest('[data-poll-vote]'); if(!b||b.disabled) return; b.disabled=true;
    try{
      const out=await pollApi('/rest/v1/rpc/vote_content_request',{method:'POST',body:JSON.stringify({p_request_id:b.dataset.pollVote,p_voter_token:visitorToken()})});
      try{localStorage.setItem(`bb-poll-voted:${b.dataset.pollVote}`,'1')}catch{}; await loadPoll();
      BBUser?.track?.('request_vote').catch(()=>{});
      showToast((Array.isArray(out)?out[0]:out)?.already_voted?'You already voted for this one.':'Vote added');
    }catch(err){b.disabled=false;showToast(err.message)}
  });

  $$('.poll-tabs [data-poll-filter]').forEach(btn=>btn.addEventListener('click',()=>{
    pollMode=btn.dataset.pollFilter;
    $$('.poll-tabs [data-poll-filter]').forEach(x=>x.classList.toggle('active',x===btn));
    }));


  // Optional viewer accounts, PWA install and My List.
  const accountDialog=$('#accountDialog');
  function renderAccount(){
    const state=BBUser?.getState?.()||{signedIn:false};
    $('#accountSignedOut')?.classList.toggle('hidden',state.signedIn);
    $('#accountSignedIn')?.classList.toggle('hidden',!state.signedIn);
    $('#accountBtn')?.classList.toggle('signed-in',state.signedIn);
    if(state.signedIn){
      const name=state.profile?.display_name||state.user?.email?.split('@')[0]||'BingeBox viewer';
      $('#accountName').textContent=name;
      $('#accountEmail').textContent=state.user?.email||'';
      $('#accountAvatar').textContent=(name.trim()[0]||'B').toUpperCase();
      $('#accountFavoriteCount').textContent=String(BBUser.getFavoriteDramaIds().size);
    }
    renderContinueWatching();
    renderMyList();
    renderForYou();
    renderWatchHistory();
    setTimeout(observeCatalogImpressions,0);
  }
  function openAccount(){ setMenu(false); setMobileTab('me'); accountDialog?.showModal(); renderAccount(); }
  $('#accountBtn')?.addEventListener('click',openAccount);
  $$('[data-account-open]').forEach(b=>b.addEventListener('click',openAccount));
  $('#closeAccountDialog')?.addEventListener('click',()=>accountDialog?.close()); accountDialog?.addEventListener('close',syncMobileTabFromPage);
  $$('.account-tabs [data-auth-tab]').forEach(btn=>btn.addEventListener('click',()=>{
    $$('.account-tabs [data-auth-tab]').forEach(x=>x.classList.toggle('active',x===btn));
    $('#signInForm')?.classList.toggle('hidden',btn.dataset.authTab!=='signin');
    $('#signUpForm')?.classList.toggle('hidden',btn.dataset.authTab!=='signup');
    $('#accountStatus').textContent='';
  }));
  $('#signInForm')?.addEventListener('submit',async e=>{
    e.preventDefault();const st=$('#accountStatus');st.textContent='Signing in…';
    try{await BBUser.signIn($('#userSignInEmail').value.trim(),$('#userSignInPassword').value);await BBUser.mergeLocalState(dramas);st.textContent='Signed in. Your progress and My List are syncing.';renderAccount();setTimeout(()=>accountDialog?.close(),650)}
    catch(err){st.textContent=err.message}
  });
  $('#signUpForm')?.addEventListener('submit',async e=>{
    e.preventDefault();const st=$('#accountStatus');st.textContent='Creating account…';
    try{
      const out=await BBUser.signUp($('#userSignUpEmail').value.trim(),$('#userSignUpPassword').value,$('#userDisplayName').value.trim());
      if(out.confirmed){await BBUser.mergeLocalState(dramas);st.textContent='Account created. Welcome to BingeBox.';renderAccount();setTimeout(()=>accountDialog?.close(),650)}
      else st.textContent='Check your email to confirm the account, then sign in here.';
    }catch(err){st.textContent=err.message}
  });
  $('#userSignOutBtn')?.addEventListener('click',async()=>{await BBUser.signOut();renderAccount();});
  window.addEventListener('bb-auth-changed',()=>{renderAccount();loadProgressEpisodeMetadata().then(()=>{renderContinueWatching();renderWatchHistory();renderForYou();}).catch(()=>{});});

  $('#modalFavoriteBtn')?.addEventListener('click',async()=>{
    const d=dramas.find(x=>x.id===modal?.dataset.activeId); if(!d)return;
    try{const on=await BBUser.toggleFavorite(d.dbId,d.id);showToast(on?'Added to My List':'Removed from My List');openDrama(d.id);renderCatalog(allDramaFilter);renderMyList();renderGenreRows();renderForYou();renderNewUpdated();renderHero(heroIndex);}
    catch(err){showToast(err.message||'Could not update My List.')}
  });

  $('#surpriseMeBtn')?.addEventListener('click',()=>{
    if(!dramas.some(d=>Number(d.episodes||0)>0))return showToast('No playable title is available yet.');
    BBUser?.track?.('surprise_me',{metadata:{source:'home'}}).catch(()=>{});
    location.href='/watch?random=1';
  });

  const installDialog=$('#installDialog');
  const installSteps=$('#installSteps');
  const installNowBtn=$('#installNowBtn');
  const installReady=$('#installReady');
  const installCopy=$('#installCopy');
  const installNote=$('#installNote');
  const standalone=()=>window.BBPWA?.isStandalone?.() || matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;

  function installInstructions(){
    const pf=window.BBPWA?.platform?.()||{};
    if(pf.ios){
      if(pf.safari) return ['Tap the Share button in Safari.','Choose “Add to Home Screen”.','Tap “Add” to finish.'];
      return ['Open bingebox.bond in Safari.','Tap Share → “Add to Home Screen”.','Tap “Add” to finish.'];
    }
    if(pf.android) return ['Open the browser menu (⋮).','Choose “Install app” or “Add to Home screen”.','Confirm Install/Add.'];
    if(pf.edge) return ['Open the Edge menu (⋯).','Choose Apps → “Install BingeBox”.','Confirm Install.'];
    if(pf.chrome) return ['Look for the install icon in the address bar, or open the Chrome menu (⋮).','Choose “Install BingeBox” (sometimes under Cast, save, and share).','Confirm Install.'];
    return ['Open your browser menu.','Look for “Install app”, “Add to Home Screen”, or “Create shortcut”.','Follow the browser confirmation.'];
  }

  function updateInstallUI(){
    const installed=standalone();
    $$('.install-trigger').forEach(b=>b.classList.toggle('hidden',installed));
    if(installed && installDialog?.open) installDialog.close();
  }

  function renderInstallDialog(){
    if(!installDialog)return;
    const installed=standalone();
    const canPrompt=!!window.BBPWA?.canPrompt?.();
    installSteps.innerHTML='';
    if(installed){
      installCopy.textContent='BingeBox is already installed on this device.';
      installReady?.classList.remove('hidden');
      installNowBtn?.classList.add('hidden');
      installNote.textContent='Launch it from your home screen or app list.';
      return;
    }
    installCopy.textContent='Open BingeBox like an app, with a home-screen icon and a cleaner full-screen experience.';
    installReady?.classList.toggle('hidden',!canPrompt);
    installNowBtn?.classList.toggle('hidden',!canPrompt);
    installInstructions().forEach((text,i)=>{
      const li=document.createElement('li');
      li.innerHTML=`<span>${i+1}</span><strong></strong>`;
      li.querySelector('strong').textContent=text;
      installSteps.appendChild(li);
    });
    const pf=window.BBPWA?.platform?.()||{};
    installNote.textContent=pf.ios?'On iPhone/iPad, installation is completed from Safari’s Share menu.':'If your browser offers native installation, the Install now button will appear automatically.';
  }

  function openInstall(){
    if(standalone()){showToast('BingeBox is already installed.');return;}
    renderInstallDialog();
    if(!installDialog.open) installDialog.showModal();
  }

  $$('.install-trigger').forEach(b=>b.addEventListener('click',async()=>{
    if(standalone())return showToast('BingeBox is already installed.');
    if(window.BBPWA?.canPrompt?.()){
      const choice=await window.BBPWA.prompt();
      if(choice?.outcome==='accepted'){showToast('Installing BingeBox…');updateInstallUI();return;}
    }
    openInstall();
  }));
  installNowBtn?.addEventListener('click',async()=>{
    const choice=await window.BBPWA?.prompt?.();
    if(choice?.outcome==='accepted'){installDialog?.close();showToast('Installing BingeBox…');}
    else renderInstallDialog();
    updateInstallUI();
  });
  $('#installCloseBtn')?.addEventListener('click',()=>installDialog?.close());
  $('#installOkayBtn')?.addEventListener('click',()=>installDialog?.close());
  installDialog?.addEventListener('click',e=>{if(e.target===installDialog)installDialog.close();});
  window.addEventListener('bb-pwa-change',()=>{updateInstallUI();if(installDialog?.open)renderInstallDialog();});
  window.addEventListener('appinstalled',()=>{updateInstallUI();if(installDialog?.open)installDialog.close();showToast('BingeBox installed');});
  updateInstallUI();

  const header = $('#siteHeader');
  const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 18);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });
  window.addEventListener('pageshow', () => { if (dramas.length) { renderContinueWatching(); renderMyList(); } });

  const revealEls = $$('[data-reveal]');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    }), { threshold: .12, rootMargin: '0px 0px -40px' });
    revealEls.forEach(el => observer.observe(el));
  } else revealEls.forEach(el => el.classList.add('is-visible'));


function enhanceBingeBoxRows(){
  const tracks=$$('.poster-grid,.compact-grid,.discovery-grid,.genre-row-track');
  tracks.forEach(track=>{
    let shell=track.closest('.bbx-row-shell');
    if(!shell){
      shell=document.createElement('div');
      shell.className='bbx-row-shell';
      track.parentNode.insertBefore(shell,track);
      shell.appendChild(track);
      const backdrop=document.createElement('div');
      backdrop.className='bbx-row-hover-backdrop';
      backdrop.setAttribute('aria-hidden','true');
      const foreground=document.createElement('div');
      foreground.className='bbx-row-hover-foreground';
      foreground.setAttribute('aria-hidden','true');
      const prev=document.createElement('button');
      const next=document.createElement('button');
      prev.type=next.type='button';
      prev.className='bbx-row-arrow bbx-row-prev';
      next.className='bbx-row-arrow bbx-row-next';
      prev.setAttribute('aria-label','Previous titles');
      next.setAttribute('aria-label','Next titles');
      prev.textContent='‹';next.textContent='›';
      shell.prepend(backdrop);
      shell.append(foreground,prev,next);
      const sync=()=>{
        const max=Math.max(0,track.scrollWidth-track.clientWidth-2);
        prev.classList.toggle('is-disabled',track.scrollLeft<4);
        next.classList.toggle('is-disabled',max<=4||track.scrollLeft>=max-2);
      };
      shell._bbxSync=sync;
      const move=dir=>track.scrollBy({left:dir*Math.max(480,track.clientWidth*.82),behavior:'smooth'});
      prev.addEventListener('click',()=>move(-1));
      next.addEventListener('click',()=>move(1));
      track.addEventListener('scroll',()=>requestAnimationFrame(sync),{passive:true});
      requestAnimationFrame(sync);
    }
    // Dynamic catalog renders replace track children after the shell exists. Re-sync
    // arrows every enhancement pass so disabled states never stay stale.
    requestAnimationFrame(()=>shell._bbxSync?.());
    $$('.poster-card',track).forEach(card=>{
      if(card.dataset.bbxHoverBound)return;
      card.dataset.bbxHoverBound='1';
      const activate=()=>{
        if(window.matchMedia?.('(hover:hover) and (pointer:fine)')?.matches===false)return;
        const shellRect=shell.getBoundingClientRect();
        const cardRect=card.getBoundingClientRect();
        shell.style.setProperty('--bbx-hover-x',`${cardRect.left-shellRect.left+cardRect.width/2}px`);
        shell.style.setProperty('--bbx-hover-y',`${cardRect.top-shellRect.top+cardRect.height*.43}px`);
        shell.classList.add('is-hovering');
        shell.closest('section,.genre-row')?.classList.add('bbx-hover-active');
        card.classList.add('is-hovered');
      };
      const deactivate=()=>{
        card.classList.remove('is-hovered');
        if(!shell.querySelector('.poster-card.is-hovered')){shell.classList.remove('is-hovering');shell.closest('section,.genre-row')?.classList.remove('bbx-hover-active');}
      };
      card.addEventListener('pointerenter',activate);
      card.addEventListener('pointerleave',deactivate);
      card.addEventListener('focus',activate);
      card.addEventListener('blur',deactivate);
    });
  });
}
const bingeboxRowObserver=new MutationObserver(()=>requestAnimationFrame(enhanceBingeBoxRows));
bingeboxRowObserver.observe(document.body,{subtree:true,childList:true});
enhanceBingeBoxRows();


  // v26.4 header + page controls
  const languageBtn=$('#languageBtn'), languageMenu=$('#languageMenu');
  languageBtn?.addEventListener('click',e=>{e.stopPropagation();const open=languageMenu?.hasAttribute('hidden');if(!languageMenu)return;if(open)languageMenu.removeAttribute('hidden');else languageMenu.setAttribute('hidden','');languageBtn.setAttribute('aria-expanded',String(open));});
  document.addEventListener('click',e=>{if(languageMenu&&!e.target.closest('.language-wrap')){languageMenu.setAttribute('hidden','');languageBtn?.setAttribute('aria-expanded','false');}});
  $('#historyBtn')?.addEventListener('click',()=>{renderAccount();accountDialog?.showModal?.();setTimeout(()=>$('#accountHistoryList')?.closest('details')?.setAttribute('open',''),0);});
  $('#scrollTopBtn')?.addEventListener('click',()=>window.scrollTo({top:0,behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth'}));

  loadCatalog();
  function setMobileTab(name){
    $$('.mobile-tabbar [data-mobile-tab]').forEach(el=>{
      const active=el.dataset.mobileTab===name;
      el.classList.toggle('active',active);
      if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
    });
  }
  function syncMobileTabFromPage(){
    if(search?.classList.contains('open'))return setMobileTab('search');
    if(accountDialog?.open)return setMobileTab('me');
    if(location.hash==='#discover'||window.scrollY>Math.max(420,window.innerHeight*.52))return setMobileTab('discover');
    setMobileTab('home');
  }
  document.addEventListener('click',e=>{
    const tab=e.target.closest?.('.mobile-tabbar [data-mobile-tab]');
    if(tab)setMobileTab(tab.dataset.mobileTab);
  });
  let mobileTabRaf=0;
  window.addEventListener('scroll',()=>{
    if(mobileTabRaf)return;
    mobileTabRaf=requestAnimationFrame(()=>{mobileTabRaf=0;syncMobileTabFromPage()});
  },{passive:true});
  window.addEventListener('hashchange',syncMobileTabFromPage);
  window.addEventListener('pageshow',syncMobileTabFromPage);


})();

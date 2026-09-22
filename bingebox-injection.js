(() => {
  const cfg=window.BINGEBOX_CONFIG||{};
  const qs=(s,r=document)=>r.querySelector(s), qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  let dramas=[], initialized=false, loading=false;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const watch=d=>`/watch?drama=${encodeURIComponent(d.slug)}&ep=1`;
  const norm=s=>String(s||'').toLowerCase();
  const meta=d=>[d.genre,...(Array.isArray(d.mood)?d.mood:[])].filter(Boolean).slice(0,3).join(' ｜ ')||'Short Drama';
  const datev=d=>Date.parse(d.publishAt||d.updatedAt||d.createdAt||0)||0;
  const favSet=()=>{const out=new Set();for(const key of ['bb-exact-favorites','bb-local-favorites']){try{const v=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(v))v.forEach(x=>out.add(String(x)))}catch{}}return out};

  function ensureLoadingNote(){
    if(!matchMedia('(min-width:768px)').matches||qs('.bb-loading-note'))return;
    const n=document.createElement('div');
    n.className='bb-loading-note';
    n.setAttribute('role','status');
    n.setAttribute('aria-live','polite');
    n.textContent='Loading BingeBox';
    document.body.appendChild(n);
  }

  function brand(){
    document.title='Watch Free Short Dramas Online | BingeBox';
    const desc='Watch free short dramas online on BingeBox — romance, revenge, fantasy, action and more.';
    const md=qs('meta[name="description"]'); if(md)md.content=desc;
    const canonical=qs('link[rel="canonical"]'); if(canonical)canonical.href='https://bingebox.bond/';
    qsa('meta[property="og:title"],meta[name="twitter:title"]').forEach(x=>x.content='Watch Free Short Dramas Online | BingeBox');
    qsa('meta[property="og:description"],meta[name="twitter:description"]').forEach(x=>x.content='Binge-worthy short dramas you can watch free online. Big drama. One little box.');
    const brandA=qs('header a[aria-label="BingeBox home"],header a[aria-label="ReelShort home"],header a.h-full.flex.shrink-0.cursor-pointer.items-center');
    if(brandA){brandA.href='/';brandA.setAttribute('aria-label','BingeBox home');brandA.className='bb-brand-lockup';brandA.innerHTML='<img class="bb-brand-mark" src="/assets/brand/mark.svg" alt=""><img class="bb-brand-wordmark" src="/assets/brand/wordmark-hd.png" alt="BingeBox">'}
    const nav=qsa('header .h-full.items-center.gap-28px a, header .h-full.items-center.gap-28px div.h-full.flex.cursor-pointer');
    if(nav[0]){nav[0].textContent='Home';nav[0].setAttribute('href','/')} if(nav[1]){nav[1].textContent='Categories';nav[1].dataset.bbScroll='categories'}
    if(nav[2]){nav[2].textContent='My List';nav[2].setAttribute('href','#bb-my-list')} if(nav[3]){nav[3].textContent='Browse';nav[3].setAttribute('href','/lite')}
    const top=qs('header a[href="/shopping"]'); if(top){top.textContent='Support';top.href='https://paymongo.page/l/support-bingebox';top.target='_blank';top.rel='noopener noreferrer';top.className='bb-support'}
    const avatar=qs('header a[aria-label="avatar"]'); if(avatar){avatar.href='#bb-my-list';avatar.setAttribute('aria-label','My List')}
    const mobileApp=qsa('header svg').find(x=>x.closest('div.items-center.hidden.md\\:flex')); const mobileWrap=mobileApp?.closest('div.items-center.hidden.md\\:flex'); if(mobileWrap){mobileWrap.style.cursor='pointer';mobileWrap.title='Browse BingeBox';mobileWrap.onclick=()=>location.href='/lite'}
  }

  function setupSearch(){
    const SEARCH_CACHE=new Map();
    const RECENT_KEY='bb-search-recent-v2';
    let selectedGenre='';
    let completeOnly=false;
    let requestController=null;
    let requestSeq=0;
    let debounceTimer=null;
    let activeIndex=-1;

    const searchNorm=s=>{const raw=String(s||'');const folded=typeof raw.normalize==='function'?raw.normalize('NFKD'):raw;return folded.replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()};
    const dice=(a,b)=>{
      a=searchNorm(a);b=searchNorm(b);
      if(!a||!b)return 0;if(a===b)return 1;
      if(a.length<2||b.length<2)return a===b?1:0;
      const grams=new Map();
      for(let i=0;i<a.length-1;i++){const g=a.slice(i,i+2);grams.set(g,(grams.get(g)||0)+1)}
      let hit=0;
      for(let i=0;i<b.length-1;i++){const g=b.slice(i,i+2),n=grams.get(g)||0;if(n){hit++;grams.set(g,n-1)}}
      return (2*hit)/((a.length-1)+(b.length-1));
    };
    const normalizeRemote=d=>({
      id:d.id,slug:d.slug,title:d.title,genre:d.genre||'Drama',mood:Array.isArray(d.mood)?d.mood:[],
      description:d.description||'',poster:d.poster_url||d.poster||'/assets/brand/mark.svg',
      featured:!!d.featured,sortOrder:Number(d.sort_order??9999),createdAt:d.created_at,
      updatedAt:d.updated_at,publishAt:d.publish_at,isComplete:!!d.is_complete,isR18:!!d.is_r18,
      score:Number(d.score||0),matchReason:d.match_reason||''
    });
    const localRank=(d,raw)=>{
      const q=searchNorm(raw);if(!q)return {score:Number(d.featured)*2+Math.max(0,1-(Date.now()-datev(d))/7776000000),reason:d.featured?'Featured':'Popular'};
      const title=searchNorm(d.title),genre=searchNorm(d.genre),moods=(d.mood||[]).map(searchNorm),desc=searchNorm(d.description);
      const words=q.split(/\s+/).filter(Boolean);
      let score=0,reason='';
      if(title===q){score+=100;reason='Exact title'}
      else if(title.startsWith(q)){score+=62;reason='Title starts with your search'}
      else if(title.includes(q)){score+=44;reason='Title match'}
      if(genre===q){score+=28;reason=reason||'Genre match'}else if(genre.includes(q)){score+=12;reason=reason||'Genre match'}
      if(moods.some(m=>m===q)){score+=22;reason=reason||'Mood match'}else if(moods.some(m=>m.includes(q))){score+=9;reason=reason||'Mood match'}
      const hay=`${title} ${genre} ${moods.join(' ')} ${desc}`;
      const wordHits=words.filter(w=>hay.includes(w)).length;
      if(words.length&&wordHits===words.length){score+=16+wordHits*2;reason=reason||'Story match'}
      else if(wordHits){score+=wordHits*3;reason=reason||'Related match'}
      if(q.length>=3){const fuzzy=dice(title,q);if(fuzzy>=.34){score+=fuzzy*25;reason=reason||'Similar title'}}
      if(d.featured)score+=.8;
      return {score,reason:reason||'Related match'};
    };
    const localResults=(query,limit=25)=>{
      const q=searchNorm(query);
      return dramas
        .filter(d=>(!selectedGenre||searchNorm(d.genre)===searchNorm(selectedGenre))&&(!completeOnly||d.isComplete))
        .map(d=>{const r=localRank(d,q);return {...d,score:r.score,matchReason:r.reason}})
        .filter(d=>!q||d.score>0)
        .sort((a,b)=>b.score-a.score||Number(b.featured)-Number(a.featured)||datev(b)-datev(a))
        .slice(0,limit);
    };
    const getRecents=()=>{try{const v=JSON.parse(localStorage.getItem(RECENT_KEY)||'[]');return Array.isArray(v)?v.slice(0,6):[]}catch{return []}};
    const saveRecent=q=>{q=String(q||'').trim();if(q.length<2)return;try{localStorage.setItem(RECENT_KEY,JSON.stringify([q,...getRecents().filter(x=>searchNorm(x)!==searchNorm(q))].slice(0,6)))}catch{}};

    const ov=document.createElement('div');
    ov.className='bb-search-overlay bb-search-v2';
    ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-label','Search BingeBox');
    ov.innerHTML=`
      <div class="bb-search-shell">
        <div class="bb-search-kicker"><span>DISCOVER BINGEBOX</span><button class="bb-search-close" type="button" aria-label="Close search">×</button></div>
        <div class="bb-search-box">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
          <input class="bb-search-input" type="search" placeholder="Title, genre, mood, story…" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-controls="bbSearchResults" aria-expanded="true">
          <kbd>/</kbd>
        </div>
        <div class="bb-search-toolbar">
          <p class="bb-search-status" role="status" aria-live="polite">Search the full BingeBox catalog</p>
          <button class="bb-search-complete" type="button" aria-pressed="false">Complete only</button>
        </div>
        <div class="bb-search-genres" aria-label="Search filters"></div>
        <div class="bb-search-recents"></div>
        <div class="bb-search-results" id="bbSearchResults" role="listbox" aria-label="Search results"></div>
      </div>`;
    document.body.appendChild(ov);

    if(!qs('#bb-search-v2-style')){
      const style=document.createElement('style');style.id='bb-search-v2-style';style.textContent=`
        .bb-search-v2{position:fixed;inset:0;z-index:12000;display:none;overflow-y:auto;padding:clamp(20px,5vh,52px) 24px 80px;background:rgba(6,6,6,.96);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);color:#fff}
        .bb-search-v2.open{display:block}.bb-search-shell{width:min(1040px,100%);margin:0 auto}
        .bb-search-kicker{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;color:#777;font-size:10px;font-weight:900;letter-spacing:.16em}
        .bb-search-close{width:42px;height:42px;border:1px solid #2b2b2b;border-radius:50%;background:#121212;color:#ddd;font-size:25px;line-height:1;cursor:pointer}
        .bb-search-close:hover,.bb-search-close:focus-visible{border-color:#ff5148;color:#fff;outline:none}
        .bb-search-box{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;padding:0 18px;border:1px solid #303030;border-radius:16px;background:#101010;box-shadow:0 20px 70px rgba(0,0,0,.28)}
        .bb-search-box:focus-within{border-color:rgba(255,81,72,.72);box-shadow:0 0 0 3px rgba(255,81,72,.1)}
        .bb-search-box svg{width:22px;height:22px;fill:none;stroke:#8c8c8c;stroke-width:1.8}.bb-search-input{min-width:0;width:100%;height:64px;border:0!important;outline:0!important;background:transparent!important;color:#fff!important;font:inherit!important;font-size:clamp(22px,3vw,34px)!important;letter-spacing:-.035em!important;text-transform:none!important;box-shadow:none!important}
        .bb-search-input::placeholder{color:#5f5f5f}.bb-search-box kbd{min-width:28px;padding:5px 8px;border:1px solid #333;border-radius:7px;background:#181818;color:#777;font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center}
        .bb-search-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 2px 8px}.bb-search-status{margin:0;color:#8a8a8a;font-size:12px}
        .bb-search-complete,.bb-search-chip,.bb-search-recent-chip{border:1px solid #2b2b2b;border-radius:999px;background:#111;color:#9d9d9d;padding:8px 12px;font:inherit;font-size:10px;font-weight:800;cursor:pointer;white-space:nowrap}
        .bb-search-complete[aria-pressed="true"],.bb-search-chip.active{border-color:#fff;background:#fff;color:#090909}.bb-search-complete:hover,.bb-search-chip:hover,.bb-search-recent-chip:hover{border-color:#ff5148;color:#fff}
        .bb-search-genres{display:flex;gap:7px;overflow-x:auto;padding:5px 1px 10px;scrollbar-width:none}.bb-search-genres::-webkit-scrollbar{display:none}
        .bb-search-recents{min-height:0;margin:2px 0 6px}.bb-search-recents:empty{display:none}.bb-search-recents-label{display:inline-block;margin-right:8px;color:#5e5e5e;font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}.bb-search-recent-chip{margin:4px 5px 4px 0;padding:6px 10px;background:transparent}
        .bb-search-results{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
        .bb-search-card{position:relative;display:grid;grid-template-columns:72px minmax(0,1fr);gap:14px;min-width:0;min-height:108px;padding:9px;border:1px solid #202020;border-radius:14px;background:#0d0d0d;color:#fff;text-decoration:none;transition:border-color .16s,background .16s,transform .16s}
        .bb-search-card:hover,.bb-search-card[aria-selected="true"]{border-color:rgba(255,81,72,.62);background:#141414;transform:translateY(-1px)}
        .bb-search-card img{width:72px;height:96px;object-fit:cover;border-radius:9px;background:#181818}.bb-search-copy{display:flex;min-width:0;flex-direction:column;justify-content:center;gap:7px;padding-right:5px}
        .bb-search-copy strong{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:15px;line-height:1.15;letter-spacing:-.015em}.bb-search-copy small{overflow:hidden;color:#777;font-size:10px;text-overflow:ellipsis;white-space:nowrap}
        .bb-search-badges{display:flex;gap:5px;flex-wrap:wrap}.bb-search-badge{padding:4px 6px;border-radius:5px;background:#1d1d1d;color:#9b9b9b;font-size:7px;font-weight:900;letter-spacing:.07em;text-transform:uppercase}.bb-search-badge.match{background:rgba(255,81,72,.13);color:#ff8178}.bb-search-badge.r18{color:#f2d8a7}.bb-search-empty{grid-column:1/-1;padding:56px 12px;text-align:center;color:#777}.bb-search-empty strong{display:block;margin-bottom:7px;color:#ddd;font-size:18px}.bb-search-v2.is-loading .bb-search-status:after{content:"";display:inline-block;width:9px;height:9px;margin-left:7px;border:1.5px solid #555;border-top-color:#ff5148;border-radius:50%;vertical-align:-1px;animation:bbSearchSpin .65s linear infinite}@keyframes bbSearchSpin{to{transform:rotate(360deg)}}
        @media(max-width:680px){.bb-search-v2{height:100dvh;padding:max(14px,env(safe-area-inset-top)) 12px calc(82px + env(safe-area-inset-bottom));overscroll-behavior:contain}.bb-search-kicker{position:sticky;top:0;z-index:3;padding:2px 0 8px;background:#060606}.bb-search-box{gap:10px;padding:0 13px;border-radius:13px}.bb-search-box svg{width:19px}.bb-search-box kbd{display:none}.bb-search-input{height:54px!important;font-size:21px!important}.bb-search-toolbar{margin-top:10px}.bb-search-status{font-size:10px}.bb-search-complete{padding:7px 10px;font-size:9px}.bb-search-results{grid-template-columns:1fr;gap:7px;margin-top:8px}.bb-search-card{grid-template-columns:55px minmax(0,1fr);min-height:82px;padding:7px;border-radius:11px}.bb-search-card img{width:55px;height:73px;border-radius:7px}.bb-search-copy{gap:5px}.bb-search-copy strong{font-size:13px}.bb-search-copy small{font-size:9px}.bb-search-badge{font-size:6px;padding:3px 5px}.bb-search-genres{padding-bottom:7px}.bb-search-chip{padding:7px 10px;font-size:9px}.bb-search-recents{white-space:nowrap;overflow-x:auto;scrollbar-width:none}}
      `;document.head.appendChild(style);
    }

    const input=qs('.bb-search-input',ov),results=qs('.bb-search-results',ov),status=qs('.bb-search-status',ov),genres=qs('.bb-search-genres',ov),recents=qs('.bb-search-recents',ov),completeBtn=qs('.bb-search-complete',ov);
    const renderGenreChips=()=>{
      const counts=new Map();dramas.forEach(d=>{const g=String(d.genre||'').trim();if(g)counts.set(g,(counts.get(g)||0)+1)});
      const top=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,7).map(x=>x[0]);
      genres.innerHTML=['',...top].map(g=>`<button class="bb-search-chip ${selectedGenre===g?'active':''}" type="button" data-search-genre="${esc(g)}">${g?esc(g.charAt(0).toUpperCase()+g.slice(1)):'All'}</button>`).join('');
    };
    const renderRecents=()=>{
      const items=getRecents();
      recents.innerHTML=items.length?'<span class="bb-search-recents-label">Recent</span>'+items.map(q=>`<button class="bb-search-recent-chip" type="button" data-search-recent="${esc(q)}">${esc(q)}</button>`).join(''):'';
    };
    const resultCard=d=>`<a class="bb-search-card" role="option" aria-selected="false" data-search-result="${esc(d.slug)}" data-search-query="${esc(input.value.trim())}" href="${watch(d)}"><img src="${esc(d.poster)}" alt="" loading="lazy" decoding="async"><span class="bb-search-copy"><strong>${esc(d.title)}</strong><small>${esc(meta(d))}</small><span class="bb-search-badges">${d.matchReason?`<em class="bb-search-badge match">${esc(d.matchReason)}</em>`:''}${d.isComplete?'<em class="bb-search-badge">Complete</em>':''}${d.isR18?'<em class="bb-search-badge r18">R18</em>':''}</span></span></a>`;
    const setActive=i=>{
      const cards=qsa('.bb-search-card',results);if(!cards.length){activeIndex=-1;return}
      activeIndex=Math.max(-1,Math.min(i,cards.length-1));
      cards.forEach((c,n)=>c.setAttribute('aria-selected',String(n===activeIndex)));
      if(activeIndex>=0)cards[activeIndex].scrollIntoView({block:'nearest'});
    };
    const paint=(items,{query='',source='local'}={})=>{
      activeIndex=-1;
      results.innerHTML=items.length?items.map(resultCard).join(''):`<div class="bb-search-empty"><strong>No matching title found</strong><span>Try a shorter title, a genre, mood, character type, or story keyword.</span></div>`;
      const q=query.trim();
      if(q)status.textContent=items.length?`${items.length} best match${items.length===1?'':'es'} across BingeBox`:'No matches in the catalog';
      else status.textContent='Search the full BingeBox catalog';
      if(source==='fallback'&&q&&items.length)status.textContent+= ' · cached results';
    };
    const fetchRemote=async(query)=>{
      const q=query.trim();
      if(q.length<2){paint(localResults(q,25),{query:q});return}
      const cacheKey=`${searchNorm(q)}|${searchNorm(selectedGenre)}|${completeOnly?1:0}`;
      if(SEARCH_CACHE.has(cacheKey)){paint(SEARCH_CACHE.get(cacheKey),{query:q,source:'cache'});return}
      requestController?.abort();const controller=new AbortController();requestController=controller;const seq=++requestSeq;
      ov.classList.add('is-loading');
      try{
        const params=new URLSearchParams({q,limit:'30'});
        if(selectedGenre)params.set('genre',selectedGenre);
        if(completeOnly)params.set('complete','true');
        const res=await fetch('/api/search?'+params.toString(),{signal:controller.signal,headers:{Accept:'application/json'},cache:'no-store'});
        if(!res.ok)throw new Error('search_'+res.status);
        const body=await res.json();if(seq!==requestSeq)return;
        const remote=(Array.isArray(body)?body:body?.items||[]).map(normalizeRemote);
        const local=localResults(q,12),seen=new Set(remote.map(d=>d.slug));
        const merged=[...remote,...local.filter(d=>!seen.has(d.slug))].slice(0,30);
        SEARCH_CACHE.set(cacheKey,merged);if(SEARCH_CACHE.size>50)SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value);
        paint(merged,{query:q,source:'remote'});
        try{window.BBUser?.track?.(merged.length?'search':'search_zero',{metadata:{query:q.slice(0,80),results:merged.length,engine:'v2'}})}catch{}
      }catch(err){
        if(err?.name==='AbortError')return;
        if(seq!==requestSeq)return;
        paint(localResults(q,25),{query:q,source:'fallback'});
      }finally{if(seq===requestSeq)ov.classList.remove('is-loading')}
    };
    const run=()=>{
      clearTimeout(debounceTimer);
      const q=input.value;
      const immediate=localResults(q,25);
      paint(immediate,{query:q,source:'local'});
      if(q.trim().length>=2){
        ov.classList.add('is-loading');
        debounceTimer=setTimeout(()=>fetchRemote(q),240);
      }else ov.classList.remove('is-loading');
    };
    const open=()=>{
      ov.classList.add('open');const root=qs('#__next');if(root)root.inert=true;
      renderGenreChips();renderRecents();paint(localResults('',16),{query:''});
      setTimeout(()=>input.focus(),40)
    };
    const close=()=>{
      requestController?.abort();clearTimeout(debounceTimer);ov.classList.remove('open');ov.classList.remove('is-loading');
      const root=qs('#__next');if(root)root.inert=false;qs('header button[aria-label="Search"]')?.focus()
    };

    const btn=qs('header button[aria-label="Search"]');if(btn)btn.addEventListener('click',e=>{e.preventDefault();open()});
    input.addEventListener('input',run);
    input.addEventListener('keydown',e=>{
      const cards=qsa('.bb-search-card',results);
      if(e.key==='ArrowDown'){e.preventDefault();setActive(activeIndex+1)}
      else if(e.key==='ArrowUp'){e.preventDefault();setActive(activeIndex<=0?cards.length-1:activeIndex-1)}
      else if(e.key==='Enter'&&activeIndex>=0&&cards[activeIndex]){e.preventDefault();saveRecent(input.value);location.href=cards[activeIndex].href}
    });
    genres.addEventListener('click',e=>{const b=e.target.closest('[data-search-genre]');if(!b)return;selectedGenre=b.dataset.searchGenre||'';renderGenreChips();run()});
    completeBtn.addEventListener('click',()=>{completeOnly=!completeOnly;completeBtn.setAttribute('aria-pressed',String(completeOnly));run()});
    recents.addEventListener('click',e=>{const b=e.target.closest('[data-search-recent]');if(!b)return;input.value=b.dataset.searchRecent||'';run();input.focus()});
    results.addEventListener('click',e=>{const a=e.target.closest('[data-search-result]');if(a)saveRecent(a.dataset.searchQuery||input.value)});
    qs('.bb-search-close',ov).onclick=close;
    ov.addEventListener('click',e=>{if(e.target===ov)close()});
    addEventListener('keydown',e=>{
      if(e.key==='Escape'&&ov.classList.contains('open'))close();
      else if(e.key==='/'&&!ov.classList.contains('open')&&!/input|textarea|select/i.test(document.activeElement?.tagName||'')){e.preventDefault();open()}
    });
  }

  function setPicture(card,d){
    qsa('.BookItem_poster__CsSCp > div:not(.BookItem_cover__qlmBl)',card).forEach(e=>e.remove());
    card.dataset.bbSlug=d.slug;card.dataset.bbDescription=d.description||'';
    const pic=qs('.BookItem_cover__qlmBl picture',card)||qs('picture',card), img=qs('[data-slider-poster="true"] img',card)||qs('img',card);
    if(pic)qsa('source',pic).forEach(s=>s.remove());
    if(img){img.src=d.poster;img.removeAttribute('srcset');img.alt=d.title;img.loading='lazy';img.decoding='async'}
    const h3=qs('.BookItem_bookMeta__dUiSZ h3',card);if(h3){let a=qs('a',h3);if(!a){a=document.createElement('a');h3.textContent='';h3.appendChild(a)}a.textContent=d.title;a.href=watch(d)}
    const m=qs('.BookItem_bookMeta__dUiSZ > div',card);if(m)m.textContent=meta(d);
    qsa('a[href]',card).forEach(a=>a.href=watch(d));
    const expo=qs('.BookItem_expoItem__MBqy6',card);if(expo){expo.style.cursor='pointer';expo.onclick=()=>location.href=watch(d)}
  }

  function shelfItems(type){
    const by=(s)=>dramas.filter(d=>norm(`${d.genre} ${(d.mood||[]).join(' ')}`).includes(s));
    const fresh=[...dramas].sort((a,b)=>datev(b)-datev(a));
    const featured=dramas.filter(d=>d.featured);
    const fav=favSet();
    const unique=(items)=>items.filter((d,i,a)=>a.findIndex(x=>x.slug===d.slug)===i);
    if(type==='new')return fresh;
    if(type==='top')return [...dramas].sort((a,b)=>Number(a.sortOrder??9999)-Number(b.sortOrder??9999)||Number(b.featured)-Number(a.featured)||datev(b)-datev(a));
    if(type==='trending')return unique([...featured,...fresh]).sort((a,b)=>Number(b.featured)-Number(a.featured)||datev(b)-datev(a));
    if(type==='romance')return by('romance');
    if(type==='fantasy')return by('fantasy');
    if(type==='revenge')return dramas.filter(d=>/revenge|drama|mafia|betray/.test(norm(`${d.genre} ${(d.mood||[]).join(' ')}`)));
    if(type==='action')return dramas.filter(d=>/action|war|crime|mafia|werewolf/.test(norm(`${d.genre} ${(d.mood||[]).join(' ')}`)));
    if(type==='mylist')return dramas.filter(d=>fav.has(d.slug));
    return dramas;
  }

  const defs=[
    ['New Release','new'],['TOP','top'],['Trending Now 🔥','trending'],['Romance 🌹','romance'],['Fantasy ✨','fantasy'],['Drama & Revenge','revenge'],['Action & Power','action'],['More to Binge','all'],['My List','mylist']
  ];
  function paintShelf(wrapper,title,type){
    const h=qs('.home_floorTitle__cIyIp h2',wrapper);
    if(h){
      const a=qs('a',h);
      if(a){a.textContent=title;a.href=type==='mylist'?'#bb-my-list':'/lite';}
      else h.textContent=title;
    }
    const viewAll=qs('.home_floorTitle__cIyIp > div',wrapper);if(viewAll){const a=document.createElement('a');a.href='/lite';a.textContent='View all ›';viewAll.replaceWith(a)}
    if(type==='mylist')wrapper.id='bb-my-list';
    if(type==='romance')wrapper.id='bb-categories';
    const cards=qsa('.BookItem_bookItem__sK4Qp',wrapper); const list=shelfItems(type);
    cards.forEach((card,i)=>{const d=list[i];(card.closest('.Slider_item__28DWA')||card).style.display=d?'':'none';if(d)setPicture(card,d);else{qsa('a',card).forEach(a=>{a.removeAttribute('href');a.textContent=''});qsa('img',card).forEach(img=>{img.src='/assets/brand/mark.svg';img.removeAttribute('srcset');img.alt=''});qsa('source',card).forEach(e=>e.remove());card.dataset.bbSlug='';}});
    let empty=qs('.bb-empty-shelf',wrapper);if(!list.length){if(!empty){empty=document.createElement('p');empty.className='bb-empty-shelf';empty.textContent=type==='mylist'?'Titles you save will appear here.':'No titles in this category yet.';wrapper.appendChild(empty)}}else empty?.remove();
  }
  function paintShelves(){
    const wrappers=qsa('.home_main_content__GxekS > .Slider_sliderWrapper__66_q7');wrappers.slice(defs.length).forEach(w=>w.remove());wrappers.slice(0,defs.length).forEach((w,i)=>paintShelf(w,defs[i][0],defs[i][1]));
    const more=qs('.home_recommendFloor__OPMn1');if(more){const h=qs('.home_floorTitle__cIyIp h2',more);if(h)h.textContent='More Recommended';qsa('.BookItem_bookItem__sK4Qp',more).forEach((c,i)=>{const d=dramas[i];c.style.display=d?'':'none';if(d)setPicture(c,d)})}
  }

  function heroSlides(){return qsa('.home_homeContainer__coYDC > section.relative.top-0 > div.absolute.inset-0.bg-black > a.absolute.inset-0')}
  function paintHero(){
    const pool=[...dramas.filter(d=>d.featured),...dramas].filter((d,i,a)=>a.findIndex(x=>x.slug===d.slug)===i).slice(0,8);if(!pool.length)return;
    heroSlides().forEach((slide,i)=>{const d=pool[i%pool.length];slide.href=watch(d);slide.classList.add('bb-hero-slide');
      const pic=qs('picture',slide);let img=pic?qs('img',pic):qs('img',slide);if(pic)qsa('source',pic).forEach(s=>s.remove());if(!img){img=document.createElement('img');img.className='bb-hero-source-poster';slide.prepend(img)}img.src=d.poster;img.removeAttribute('srcset');img.alt=d.title;img.loading='eager';img.decoding='async';
      let sharp=qs('.bb-hero-poster',slide);if(!sharp){sharp=document.createElement('img');sharp.className='bb-hero-poster';slide.appendChild(sharp)}sharp.src=d.poster;sharp.alt='';sharp.setAttribute('aria-hidden','true');
      const title=qs('h2',slide);if(title)title.textContent=d.title;const desc=qs('p',slide);if(desc)desc.textContent=d.description||'Binge-worthy short drama on BingeBox.';
      const spans=qsa('span.truncate.whitespace-nowrap',slide);if(spans[0])spans[0].textContent=d.featured?'Trending':'New';if(spans[1])spans[1].textContent=d.genre||'Drama';
    });
    const hero=qs('section[aria-label="Featured series"]');
    ['Show','Preview'].forEach(prefix=>qsa('button[aria-label^="'+prefix+' "]',hero).forEach((btn,i)=>{
      const d=pool[i%pool.length];btn.setAttribute('aria-label',prefix+' '+d.title);
      qsa('source',btn).forEach(e=>e.remove());qsa('img',btn).forEach(img=>{img.src=d.poster;img.removeAttribute('srcset');img.alt=d.title});
    }));
  }

  const HOME_CACHE_KEY='bb-home-catalog-v3';
  const HOME_LIMIT=160;

  function normalizeRows(rows){
    return (Array.isArray(rows)?rows:[]).map(d=>({
      id:d.id,slug:d.slug,title:d.title,genre:d.genre||'Drama',mood:d.mood||[],
      description:d.description||'',poster:d.poster_url||d.poster||'/assets/brand/mark.svg',
      featured:!!d.featured,sortOrder:Number(d.sort_order??d.sortOrder??9999),
      episodes:Number(d.episodes||0),createdAt:d.created_at||d.createdAt,
      updatedAt:d.updated_at||d.updatedAt,publishAt:d.publish_at||d.publishAt,
      isComplete:!!(d.is_complete??d.isComplete),isR18:!!(d.is_r18??d.isR18)
    })).filter(d=>d.slug&&d.title);
  }

  function readCachedRows(){
    try{
      const value=JSON.parse(localStorage.getItem(HOME_CACHE_KEY)||'null');
      return Array.isArray(value?.items)?value.items:[];
    }catch{return []}
  }

  function writeCachedRows(rows){
    try{localStorage.setItem(HOME_CACHE_KEY,JSON.stringify({at:Date.now(),items:rows.slice(0,HOME_LIMIT)}))}catch{}
  }

  function applyRows(rows){
    const next=normalizeRows(rows);
    if(!next.length)throw new Error('EMPTY_CATALOG');
    dramas=next;
    paintHero();
    paintShelves();
    document.documentElement.classList.remove('bb-catalog-unavailable');
    window.BINGEBOX_EXACT_DRAMAS=dramas;
    window.dispatchEvent(new CustomEvent('bb-catalog-ready'));
  }

  async function fetchHomeRows(signal){
    const staticUrl=String(cfg.catalogEndpoint||'/data/catalog.json');
    try{
      const staticRes=await fetch(staticUrl,{
        signal,
        cache:'no-store',
        headers:{Accept:'application/json'}
      });
      if(staticRes.ok){
        const body=await staticRes.json();
        const rows=Array.isArray(body)?body:body?.items;
        if(Array.isArray(rows)&&rows.length)return rows.slice(0,HOME_LIMIT);
      }
    }catch(err){
      if(signal.aborted)throw err;
    }

    try{
      const res=await fetch('/api/catalog',{signal,headers:{Accept:'application/json'}});
      if(!res.ok)throw new Error(`Catalog API ${res.status}`);
      const body=await res.json();
      const rows=Array.isArray(body)?body:body?.items;
      if(!Array.isArray(rows)||!rows.length)throw new Error('EMPTY_CATALOG');
      return rows;
    }catch(apiError){
      if(signal.aborted)throw apiError;
      const base=String(cfg.supabaseUrl||'').replace(/\/$/,'');
      if(!base||!cfg.supabasePublishableKey)throw apiError;
      const params=new URLSearchParams({
        published:'eq.true',
        select:'id,slug,title,genre,mood,description,poster_url,featured,sort_order,created_at,updated_at,is_complete,publish_at,is_r18',
        limit:String(HOME_LIMIT)
      });
      const res=await fetch(`${base}/rest/v1/dramas?${params}`,{
        signal,
        headers:{apikey:cfg.supabasePublishableKey,Accept:'application/json'}
      });
      if(!res.ok)throw new Error(`Catalog ${res.status}`);
      return await res.json();
    }
  }

  async function load(){
    if(loading)return;
    loading=true;
    ensureLoadingNote();
    document.documentElement.classList.add('bb-pending');
    qs('.bb-data-error')?.remove();

    if(!initialized){
      brand();
      setupSearch();
      initialized=true;
      qsa('[data-bb-scroll]').forEach(el=>el.addEventListener('click',()=>qs('#bb-categories')?.scrollIntoView({behavior:'smooth',block:'start'})));
    }

    let hadCatalog=false;
    const cached=readCachedRows();
    if(cached.length){
      try{
        applyRows(cached);
        hadCatalog=true;
        document.documentElement.classList.remove('bb-pending');
        qs('.bb-loading-note')?.remove();
      }catch{}
    }

    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),6500);
    try{
      const rows=await fetchHomeRows(controller.signal);
      applyRows(rows);
      writeCachedRows(rows);
      hadCatalog=true;
    }catch(err){
      if(!hadCatalog){
        document.documentElement.classList.add('bb-catalog-unavailable');
        const n=document.createElement('section');
        n.className='bb-data-error';
        n.setAttribute('role','status');
        const message=document.createElement('p');
        message.textContent=err.message==='EMPTY_CATALOG'?'No published titles yet. Please check back soon.':'The catalog could not load. Please try again.';
        const retry=document.createElement('button');
        retry.type='button';
        retry.textContent='Try again';
        retry.addEventListener('click',load);
        n.append(message,retry);
        qs('main')?.prepend(n);
      }
    }finally{
      clearTimeout(timeout);
      loading=false;
      document.documentElement.classList.remove('bb-pending');
      qs('.bb-loading-note')?.remove();
    }
  }
  window.addEventListener('bb-exact-favorites-changed',()=>{if(dramas.length)paintShelves()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});else load();
})();

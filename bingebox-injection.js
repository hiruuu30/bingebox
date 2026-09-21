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
    const ov=document.createElement('div');ov.className='bb-search-overlay';ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-label','Search BingeBox');ov.innerHTML='<div class="bb-search-head"><input class="bb-search-input" type="search" placeholder="Search BingeBox titles, genres or moods…" autocomplete="off"><button class="bb-search-close" type="button" aria-label="Close">×</button></div><div class="bb-search-results"></div>';document.body.appendChild(ov);
    const input=qs('.bb-search-input',ov),results=qs('.bb-search-results',ov); const render=()=>{const q=norm(input.value.trim());const list=dramas.filter(d=>!q||norm(`${d.title} ${d.genre} ${(d.mood||[]).join(' ')}`).includes(q)).slice(0,25);results.innerHTML=list.map(d=>`<a class="bb-search-card" href="${watch(d)}"><img src="${esc(d.poster)}" alt="${esc(d.title)}"><strong>${esc(d.title)}</strong><small>${esc(meta(d))}</small></a>`).join('')||'<p>No matching title.</p>'};
    const root=qs('#__next');const open=()=>{ov.classList.add('open');if(root)root.inert=true;render();setTimeout(()=>input.focus(),50)},close=()=>{ov.classList.remove('open');if(root)root.inert=false;qs('header button[aria-label="Search"]')?.focus()};
    const btn=qs('header button[aria-label="Search"]'); if(btn)btn.addEventListener('click',e=>{e.preventDefault();open()}); input.addEventListener('input',render);qs('.bb-search-close',ov).onclick=close;ov.addEventListener('click',e=>{if(e.target===ov)close()});addEventListener('keydown',e=>{if(e.key==='Escape')close()});
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

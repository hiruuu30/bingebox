(() => {
  const cfg=window.BINGEBOX_CONFIG||{};
  const qs=(s,r=document)=>r.querySelector(s), qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  let dramas=[];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const watch=d=>`/watch?drama=${encodeURIComponent(d.slug)}&ep=1`;
  const norm=s=>String(s||'').toLowerCase();
  const meta=d=>[d.genre,...(Array.isArray(d.mood)?d.mood:[])].filter(Boolean).slice(0,3).join(' ｜ ')||'Short Drama';
  const datev=d=>Date.parse(d.publishAt||d.updatedAt||d.createdAt||0)||0;
  const favSet=()=>{try{const v=JSON.parse(localStorage.getItem('bb-exact-favorites')||'[]');return new Set(Array.isArray(v)?v:[])}catch{return new Set()}};

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
    const ov=document.createElement('div');ov.className='bb-search-overlay';ov.innerHTML='<div class="bb-search-head"><input class="bb-search-input" type="search" placeholder="Search BingeBox titles, genres or moods…" autocomplete="off"><button class="bb-search-close" type="button" aria-label="Close">×</button></div><div class="bb-search-results"></div>';document.body.appendChild(ov);
    const input=qs('.bb-search-input',ov),results=qs('.bb-search-results',ov); const render=()=>{const q=norm(input.value.trim());const list=dramas.filter(d=>!q||norm(`${d.title} ${d.genre} ${(d.mood||[]).join(' ')}`).includes(q)).slice(0,25);results.innerHTML=list.map(d=>`<a class="bb-search-card" href="${watch(d)}"><img src="${esc(d.poster)}" alt="${esc(d.title)}"><strong>${esc(d.title)}</strong><small>${esc(meta(d))}</small></a>`).join('')||'<p>No matching title.</p>'};
    const open=()=>{ov.classList.add('open');render();setTimeout(()=>input.focus(),50)},close=()=>ov.classList.remove('open');
    const btn=qs('header button[aria-label="Search"]'); if(btn)btn.addEventListener('click',e=>{e.preventDefault();open()}); input.addEventListener('input',render);qs('.bb-search-close',ov).onclick=close;ov.addEventListener('click',e=>{if(e.target===ov)close()});addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  }

  function setPicture(card,d){
    card.dataset.bbSlug=d.slug;card.dataset.bbDescription=d.description||'';
    const pic=qs('.BookItem_cover__qlmBl picture',card)||qs('picture',card), img=qs('[data-slider-poster="true"] img',card)||qs('img',card);
    if(pic)qsa('source',pic).forEach(s=>s.remove());
    if(img){img.src=d.poster;img.removeAttribute('srcset');img.alt=d.title;img.loading='lazy';img.decoding='async'}
    const h3=qs('.BookItem_bookMeta__dUiSZ h3',card);if(h3){let a=qs('a',h3);if(!a){a=document.createElement('a');h3.textContent='';h3.appendChild(a)}a.textContent=d.title;a.href=watch(d)}
    const m=qs('.BookItem_bookMeta__dUiSZ > div',card);if(m)m.textContent=meta(d);
    const expo=qs('.BookItem_expoItem__MBqy6',card);if(expo){expo.style.cursor='pointer';expo.onclick=()=>location.href=watch(d)}
  }

  function shelfItems(type){
    const by=(s)=>dramas.filter(d=>norm(`${d.genre} ${(d.mood||[]).join(' ')}`).includes(s));
    const fresh=[...dramas].sort((a,b)=>datev(b)-datev(a));
    const featured=dramas.filter(d=>d.featured);
    const fav=favSet();
    if(type==='originals')return [...featured,...dramas.filter(d=>!d.featured)];
    if(type==='new')return fresh;
    if(type==='top')return dramas;
    if(type==='trending')return [...featured,...fresh,...dramas];
    if(type==='romance')return by('romance');
    if(type==='fantasy')return by('fantasy');
    if(type==='revenge')return dramas.filter(d=>/revenge|drama|mafia|betray/.test(norm(`${d.genre} ${(d.mood||[]).join(' ')}`)));
    if(type==='action')return dramas.filter(d=>/action|war|crime|mafia|werewolf/.test(norm(`${d.genre} ${(d.mood||[]).join(' ')}`)));
    if(type==='mylist')return dramas.filter(d=>fav.has(d.slug));
    return dramas;
  }

  const defs=[
    ['BingeBox Originals','originals'],['New Release','new'],['TOP','top'],['Trending Now 🔥','trending'],['Romance 🌹','romance'],['Fantasy ✨','fantasy'],['Drama & Revenge','revenge'],['Action & Power','action'],['More to Binge','all'],['My List','mylist']
  ];
  function paintShelf(wrapper,title,type){
    const h=qs('.home_floorTitle__cIyIp h2',wrapper);
    if(h){
      const a=qs('a',h);
      if(a){a.textContent=title;a.href=type==='mylist'?'#bb-my-list':'#';}
      else h.textContent=title;
    }
    if(type==='mylist')wrapper.id='bb-my-list';
    if(type==='romance')wrapper.id='bb-categories';
    let list=shelfItems(type);if(!list.length)list=dramas;
    qsa('.BookItem_bookItem__sK4Qp',wrapper).forEach((card,i)=>setPicture(card,list[i%list.length]));
  }
  function paintShelves(){
    const wrappers=qsa('.home_main_content__GxekS > .Slider_sliderWrapper__66_q7');wrappers.slice(0,defs.length).forEach((w,i)=>paintShelf(w,defs[i][0],defs[i][1]));
    const more=qs('.home_recommendFloor__OPMn1');if(more){const h=qs('.home_floorTitle__cIyIp h2',more);if(h)h.textContent='More Recommended';qsa('.BookItem_bookItem__sK4Qp',more).forEach((c,i)=>setPicture(c,dramas[(i+17)%dramas.length]))}
  }

  function heroSlides(){return qsa('.home_homeContainer__coYDC > section.relative.top-0 > div.absolute.inset-0.bg-black > a.absolute.inset-0')}
  function paintHero(){
    const pool=[...dramas.filter(d=>d.featured),...dramas].filter((d,i,a)=>a.findIndex(x=>x.slug===d.slug)===i).slice(0,8);if(!pool.length)return;
    heroSlides().forEach((slide,i)=>{const d=pool[i%pool.length];slide.href=watch(d);slide.classList.add('bb-hero-slide');
      const pic=qs('picture',slide), img=pic?qs('img',pic):qs('img',slide);if(pic)qsa('source',pic).forEach(s=>s.remove());if(img){img.src=d.poster;img.removeAttribute('srcset');img.alt=d.title}
      let sharp=qs('.bb-hero-poster',slide);if(!sharp){sharp=document.createElement('img');sharp.className='bb-hero-poster';slide.appendChild(sharp)}sharp.src=d.poster;sharp.alt='';sharp.setAttribute('aria-hidden','true');
      const title=qs('h2',slide);if(title)title.textContent=d.title;const desc=qs('p',slide);if(desc)desc.textContent=d.description||'Binge-worthy short drama on BingeBox.';
      const spans=qsa('span.truncate.whitespace-nowrap',slide);if(spans[0])spans[0].textContent=i<3?'Trending':'BingeBox';if(spans[1])spans[1].textContent=d.genre||'Drama';
    });
  }

  async function load(){
    brand();setupSearch();
    qsa('[data-bb-scroll]').forEach(el=>el.addEventListener('click',()=>qs('#bb-categories')?.scrollIntoView({behavior:'smooth',block:'start'})));
    try{
      const base=String(cfg.supabaseUrl||'').replace(/\/$/,'');if(!base||!cfg.supabasePublishableKey)throw new Error('BingeBox backend config missing');
      const url=`${base}/rest/v1/dramas?published=eq.true&select=id,slug,title,genre,mood,description,poster_url,featured,sort_order,created_at,updated_at,is_complete,publish_at,is_r18,published_episode_stats:episodes(count)&episodes.published=eq.true&order=sort_order.asc,created_at.desc`;
      const res=await fetch(url,{headers:{apikey:cfg.supabasePublishableKey,Accept:'application/json'}});if(!res.ok)throw new Error(`Catalog ${res.status}`);const rows=await res.json();
      dramas=rows.map(d=>({id:d.id,slug:d.slug,title:d.title,genre:d.genre||'Drama',mood:d.mood||[],description:d.description||'',poster:d.poster_url||'/assets/brand/mark.svg',featured:!!d.featured,episodes:Number(d.published_episode_stats?.[0]?.count||0),createdAt:d.created_at,updatedAt:d.updated_at,publishAt:d.publish_at,isComplete:!!d.is_complete,isR18:!!d.is_r18})).filter(d=>d.slug&&d.title);
      if(!dramas.length)throw new Error('No published BingeBox titles');paintHero();paintShelves();
      window.BINGEBOX_EXACT_DRAMAS=dramas;
    }catch(err){console.error(err);const n=document.createElement('div');n.className='bb-data-error';n.textContent='BingeBox catalog could not load. Check your connection and refresh.';document.body.appendChild(n)}finally{document.documentElement.classList.remove('bb-pending');setTimeout(()=>qs('.bb-loading-note')?.remove(),250)}
  }
  window.addEventListener('bb-exact-favorites-changed',()=>{if(dramas.length)paintShelves()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});else load();
})();

(() => {
  const mobile=matchMedia('(max-width:767px)');
  const q=(s,r=document)=>r.querySelector(s);
  const all=(s,r=document)=>[...r.querySelectorAll(s)];
  const icons={
    home:'<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/>',
    browse:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    categories:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
    save:'<path d="M6 3h12v18l-6-4-6 4z"/>',
    share:'<path d="M12 16V3m-5 5 5-5 5 5M5 13v8h14v-8"/>'
  };
  const svg=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
  function init(){
    const nav=document.createElement('nav');nav.className='bb-mobile-nav';nav.setAttribute('aria-label','Mobile navigation');
    nav.innerHTML='<a href="/" aria-label="Home">'+svg('home')+'<span>Home</span></a><a href="/lite" aria-label="Browse">'+svg('browse')+'<span>Browse</span></a><a href="#bb-categories" aria-label="Categories">'+svg('categories')+'<span>Categories</span></a><a href="#bb-my-list" aria-label="My List">'+svg('save')+'<span>My List</span></a>';
    q('#__next').append(nav);
    const activate=()=>all('a',nav).forEach(a=>{const active=location.hash?a.getAttribute('href')===location.hash:a.getAttribute('href')==='/';if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
    addEventListener('hashchange',activate);activate();
    const status=document.createElement('div');status.className='bb-mobile-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');document.body.append(status);
    let statusTimer;const announce=message=>{status.textContent=message;clearTimeout(statusTimer);statusTimer=setTimeout(()=>status.textContent='',2500)};
    const favorites=()=>{try{return new Set(JSON.parse(localStorage.getItem('bb-local-favorites')||localStorage.getItem('bb-exact-favorites')||'[]'))}catch{return new Set()}};
    const refresh=()=>{const saved=favorites();all('.bb-card-save').forEach(button=>{const card=button.closest('[data-bb-slug]'),on=!!card&&saved.has(card.dataset.bbSlug);button.setAttribute('aria-pressed',String(on));button.setAttribute('aria-label',(on?'Remove from':'Add to')+' My List');button.querySelector('span').textContent=on?'Saved':'Save'})};
    all('.BookItem_bookItem__sK4Qp').forEach(card=>{
      const actions=document.createElement('div');actions.className='bb-card-actions';
      actions.innerHTML='<button class="bb-card-save" type="button" aria-label="Add to My List" aria-pressed="false">'+svg('save')+'<span>Save</span></button><button class="bb-card-share" type="button" aria-label="Share title">'+svg('share')+'<span>Share</span></button>';
      card.append(actions);
      actions.addEventListener('click',async e=>{
        const button=e.target.closest('button');if(!button)return;e.preventDefault();e.stopPropagation();
        const slug=card.dataset.bbSlug;if(!slug)return;
        if(button.classList.contains('bb-card-save')){
          const saved=favorites(),on=!saved.has(slug);if(on)saved.add(slug);else saved.delete(slug);
          try{const value=JSON.stringify([...saved]);localStorage.setItem('bb-local-favorites',value);localStorage.setItem('bb-exact-favorites',value);window.dispatchEvent(new CustomEvent('bb-exact-favorites-changed'));refresh();announce(on?'Added to My List':'Removed from My List')}catch{announce('Could not save this title. Please try again.')}
        }else{
          const link=q('.BookItem_bookMeta__dUiSZ a',card);if(!link)return;
          try{if(navigator.share)await navigator.share({title:link.textContent,url:link.href});else{await navigator.clipboard.writeText(link.href);announce('Link copied')}}catch(error){if(error.name!=='AbortError')announce('Sharing is unavailable. Open the title and copy its address.')}
        }
      });
    });
    addEventListener('bb-exact-favorites-changed',refresh);
    addEventListener('bb-catalog-ready',refresh);
    addEventListener('storage',e=>{if(e.key==='bb-local-favorites'||e.key==='bb-exact-favorites'){window.dispatchEvent(new CustomEvent('bb-exact-favorites-changed'));refresh()}});
    refresh();
    // Native touch scrolling owns the shelves on phones. Suppress a tap after a swipe.
    all('.Slider_sliderList__o0xyY').forEach(list=>{
      let start=null,movedUntil=0;
      list.addEventListener('touchstart',e=>{const t=e.touches[0];start=t?{x:t.clientX,y:t.clientY}:null},{passive:true});
      list.addEventListener('touchmove',e=>{if(!mobile.matches||!start)return;const t=e.touches[0];if(t&&Math.hypot(t.clientX-start.x,t.clientY-start.y)>10)movedUntil=Date.now()+500},{passive:true});
      list.addEventListener('click',e=>{if(mobile.matches&&Date.now()<movedUntil){e.preventDefault();e.stopImmediatePropagation()}},true);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
(() => {
  const qs=(s,r=document)=>r.querySelector(s);
  const qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const resetScroll=()=>{try{history.scrollRestoration='manual'}catch{} window.scrollTo(0,0)};

  function setupHero(){
    const hero=qs('.home_homeContainer__coYDC > section.relative.top-0');
    if(!hero)return;
    const slides=qsa(':scope > div.absolute.inset-0.bg-black > a.absolute.inset-0',hero);
    if(slides.length<2)return;
    let index=slides.findIndex(s=>s.classList.contains('opacity-100'));
    if(index<0)index=0;
    const show=(next)=>{
      index=(next+slides.length)%slides.length;
      qsa('button[aria-label^="Show "],button[aria-label^="Preview "]',hero).forEach((b,i)=>b.setAttribute('aria-pressed',String(i%slides.length===index)));
      slides.forEach((s,i)=>{
        const on=i===index;
        s.setAttribute('aria-hidden',String(!on));s.tabIndex=on?0:-1;
        s.classList.toggle('opacity-100',on);
        s.classList.toggle('opacity-0',!on);
        s.classList.toggle('z-1',on);
        s.classList.toggle('z-0',!on);
        s.classList.toggle('pointer-events-none',!on);
        if(on)s.removeAttribute('data-clone-hidden'); else s.setAttribute('data-clone-hidden','1');
      });
    };
    const controls=qsa('button[aria-label^="Show "],button[aria-label^="Preview "]',hero);
    controls.forEach((button,i)=>button.addEventListener('click',()=>show(i%slides.length)));
    qs('button[aria-label="Previous banner thumbnails"]',hero)?.addEventListener('click',()=>show(index-1));
    qs('button[aria-label="Next banner thumbnails"]',hero)?.addEventListener('click',()=>show(index+1));
    show(index);
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer=reduced?null:setInterval(()=>show(index+1),6500);
    let touchStart=null,suppressClickUntil=0;
    hero.addEventListener('touchstart',e=>{
      if(e.touches.length!==1){touchStart=null;return;}
      const t=e.touches[0];touchStart={x:t.clientX,y:t.clientY};clearInterval(timer);
    },{passive:true});
    hero.addEventListener('touchend',e=>{
      if(touchStart&&e.changedTouches.length){
        const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;
        if(Math.abs(dx)>35&&Math.abs(dx)>Math.abs(dy)*1.3){show(index+(dx<0?1:-1));suppressClickUntil=Date.now()+500;}
      }
      touchStart=null;clearInterval(timer);timer=reduced?null:setInterval(()=>show(index+1),6500);
    },{passive:true});
    hero.addEventListener('touchcancel',()=>{touchStart=null;clearInterval(timer);timer=reduced?null:setInterval(()=>show(index+1),6500)},{passive:true});
    hero.addEventListener('click',e=>{if(Date.now()<suppressClickUntil){e.preventDefault();e.stopImmediatePropagation()}},true);
    hero.addEventListener('mouseenter',()=>clearInterval(timer));
    hero.addEventListener('mouseleave',()=>{clearInterval(timer);timer=reduced?null:setInterval(()=>show(index+1),6500)});
  }

  function setupShelves(){
    qsa('.Slider_sliderContainer__2F8gq').forEach(container=>{
      const list=qs('.Slider_sliderList__o0xyY',container);
      if(!list)return;
      const items=qsa(':scope > .Slider_item__28DWA',list);
      if(!items.length)return;
      let x=0;
      const step=()=>{
        const a=items[0].getBoundingClientRect(),b=items[1]?.getBoundingClientRect();
        return b?Math.max(1,b.left-a.left):Math.max(1,a.width+12)
      };
      const maxX=()=>Math.max(0,list.scrollWidth-container.clientWidth+12);
      const apply=()=>{
        if(matchMedia('(max-width:767px)').matches){x=0;list.style.transform='none';return;}
        x=Math.min(maxX(),Math.max(0,x));
        list.style.transition='transform 500ms ease';
        list.style.transform=`translate3d(${-x}px,0,0)`;
        const p=qs('.Slider_prevButton__5XAPR',container),n=qs('.Slider_nextButton__a5KCv',container);
        p?.classList.toggle('Slider_disable__GAXYV',x<=1);
        n?.classList.toggle('Slider_disable__GAXYV',x>=maxX()-1);
      };
      qs('.Slider_prevButton__5XAPR button',container)?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();x-=step()*4;apply()});
      qs('.Slider_nextButton__a5KCv button',container)?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();x+=step()*4;apply()});
      let down=false,dragged=false,sx=0,start=0;
      list.addEventListener('pointerdown',e=>{if(matchMedia('(max-width:767px)').matches||e.button!==0)return;down=true;dragged=false;sx=e.clientX;start=x});
      list.addEventListener('pointermove',e=>{if(!down)return;if(Math.abs(sx-e.clientX)<6&&!dragged)return;dragged=true;list.setPointerCapture?.(e.pointerId);x=Math.max(0,Math.min(maxX(),start+(sx-e.clientX)));list.style.transition='none';list.style.transform=`translate3d(${-x}px,0,0)`});
      const up=()=>{if(!down)return;down=false;apply()};
      list.addEventListener('click',e=>{if(dragged){e.preventDefault();e.stopPropagation();dragged=false}},{capture:true});
      list.addEventListener('lostpointercapture',up);list.addEventListener('pointerleave',up);
      list.addEventListener('pointerup',up);list.addEventListener('pointercancel',up);
      window.addEventListener('resize',apply,{passive:true});
      apply();
    });
  }

  /* Exact visible description from the supplied ReelShort reference. Other cards
     reserve the same two-line description area so hover geometry never collapses. */
  const descriptions={
    'Demigod Under Oath':'Odysseus is the secret demigod son of Apollo, bound by a deathbed vow to...'
  };

  const playSvg='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8.2 5.7c0-1.2 1.3-1.9 2.3-1.2l8.1 5.1c.9.6.9 1.9 0 2.5l-8.1 5.1c-1 .7-2.3 0-2.3-1.2V5.7Z"/></svg>';
  const bookmarkSvg='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3.5h10c1.1 0 2 .9 2 2v15l-7-4.1L5 20.5v-15c0-1.1.9-2 2-2Z"/></svg>';
  const shareSvg='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.7 5.1 20 10.3l-5.3 5.2v-3.2c-4.3.2-7.1 1.8-9.2 5.2.7-5.4 3.7-8.4 9.2-9V5.1Z"/></svg>';

  let activeController=null;

  function cardData(card){
    const img=qs('[data-slider-poster="true"] img',card)||qs('img',card);
    if(!img)return null;
    const title=(qs('.BookItem_bookMeta__dUiSZ h3',card)?.textContent||img.alt||'').trim();
    const meta=(qs('.BookItem_bookMeta__dUiSZ > div',card)?.textContent||'').trim();
    const link=qs('.BookItem_bookMeta__dUiSZ h3 a',card)?.getAttribute('href')||'#';
    return {img,title,meta,link,src:img.currentSrc||img.src,description:card.dataset.bbDescription||'',slug:card.dataset.bbSlug||''};
  }

  function buildHover(card){
    const data=cardData(card); if(!data)return null;
    const backdropRoot=qs(':scope > .BookItem_localBackdropRoot__AEL70',card);
    const foregroundRoot=qs(':scope > .BookItem_localForegroundRoot___bhVT',card);
    if(!backdropRoot||!foregroundRoot)return null;

    const backdrop=document.createElement('div');
    backdrop.className='HoverCard_cardBackdrop__RXJ06 HoverCard_active__sKYGl rs-source-backdrop';
    backdrop.innerHTML=`
      <div class="HoverCard_backgroundCover__NB2pG rs-source-background-cover"><img alt="" aria-hidden="true"></div>
      <div class="HoverCard_blurMask__2ICqP rs-source-blur-mask" aria-hidden="true"></div>`;
    qs('img',backdrop).src=data.src;

    const foreground=document.createElement('div');
    foreground.className='HoverCard_foregroundGroup__Y3qxU HoverCard_active__sKYGl rs-source-foreground';
    foreground.innerHTML=`
      <div class="HoverCard_foregroundCover__mwFSm HoverCard_active__sKYGl rs-source-foreground-cover">
        <img alt="">
      </div>
      <div class="HoverCard_details__CfNQn HoverCard_active__sKYGl rs-source-details">
        <div class="rs-hover-info">
          <div class="rs-hover-title"></div>
          <div class="rs-hover-meta"></div>
          <div class="HoverCard_description__Xeqci rs-hover-description"></div>
        </div>
        <div class="HoverCard_actions__x67m0 rs-hover-actions">
          <button class="HoverCard_playButton__ZxwAF rs-hover-action rs-hover-play" type="button" aria-label="Play">${playSvg}</button>
          <button class="HoverCard_iconButton__m56wS rs-hover-action rs-hover-secondary" type="button" aria-label="Save">${bookmarkSvg}</button>
          <button class="HoverCard_iconButton__m56wS rs-hover-action rs-hover-secondary" type="button" aria-label="Share">${shareSvg}</button>
        </div>
      </div>`;
    qs('.rs-source-foreground-cover img',foreground).src=data.src;
    qs('.rs-source-foreground-cover img',foreground).alt=data.title;
    qs('.rs-hover-title',foreground).textContent=data.title;
    qs('.rs-hover-meta',foreground).textContent=data.meta;
    qs('.rs-hover-description',foreground).textContent=data.description||descriptions[data.title]||' ';

    const play=qs('[aria-label="Play"]',foreground);
    const save=qs('[aria-label="Save"]',foreground);
    const share=qs('[aria-label="Share"]',foreground);
    try{const fav=new Set();for(const key of ['bb-exact-favorites','bb-local-favorites']){const value=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(value))value.forEach(x=>fav.add(String(x)))}if(data.slug&&fav.has(data.slug))save.classList.add('rs-collected','HoverCard_collected__83dCr')}catch{}

    qs('.rs-source-foreground-cover',foreground).addEventListener('click',()=>{
      if(data.link&&data.link!=='#')location.href=data.link;
    });
    play.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      if(data.link&&data.link!=='#') location.href=data.link;
    });
    save.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      const slug=data.slug||card.dataset.bbSlug||'';
      let fav=[];try{const merged=new Set();for(const key of ['bb-exact-favorites','bb-local-favorites']){const value=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(value))value.forEach(x=>merged.add(String(x)))}fav=[...merged]}catch{}
      const set=new Set(Array.isArray(fav)?fav:[]);
      if(slug){if(set.has(slug))set.delete(slug);else set.add(slug);const saved=JSON.stringify([...set]);localStorage.setItem('bb-exact-favorites',saved);localStorage.setItem('bb-local-favorites',saved);}
      const on=slug?set.has(slug):!save.classList.contains('rs-collected');
      save.classList.toggle('rs-collected',on);
      save.classList.toggle('HoverCard_collected__83dCr',on);
      window.dispatchEvent(new CustomEvent('bb-exact-favorites-changed'));
    });
    share.addEventListener('click',async e=>{
      e.preventDefault();e.stopPropagation();
      const url=location.origin+(data.link&&data.link!=='#'?data.link:location.pathname);
      try{if(navigator.share)await navigator.share({title:data.title,url});else await navigator.clipboard?.writeText(url)}catch{}
    });

    backdropRoot.appendChild(backdrop);
    foregroundRoot.appendChild(foreground);
    return {backdrop,foreground,data};
  }

  function setupHover(){
    qsa('.BookItem_bookItem__sK4Qp').forEach(card=>{
      const item=card.closest('.Slider_item__28DWA')||card.parentElement;
      let ui=null,openTimer=null,closeTimer=null,clearTimer=null,openFrame=null;

      const openNow=()=>{
        clearTimeout(openTimer);clearTimeout(closeTimer);clearTimeout(clearTimer);cancelAnimationFrame(openFrame);
        if(activeController&&activeController.card!==card) activeController.close(true);
        if(ui&&ui.data.slug!==card.dataset.bbSlug){ui.backdrop.remove();ui.foreground.remove();ui=null}
        ui=ui||buildHover(card); if(!ui)return;

        card.classList.add('rs-hover-active');
        item?.classList.add('rs-hover-item-active');
        const shelf=card.closest('.Slider_sliderWrapper__66_q7');
        shelf?.classList.add('rs-hover-shelf-active');
        // Fit above the current card's bottom, leaving the next shelf untouched.
        const cr=card.getBoundingClientRect();
        const container=card.closest('.Slider_sliderContainer__2F8gq');
        const bounds=container?.getBoundingClientRect();
        const panelW=cr.width+30;
        const minLeft=Math.max(8,bounds?.left||8);
        const maxRight=Math.min(innerWidth-8,bounds?.right||innerWidth-8);
        const left=Math.max(minLeft,Math.min(maxRight-panelW,cr.left-15));
        const headerBottom=Math.max(0,qs('header')?.getBoundingClientRect().bottom||0);
        const bottom=Math.min(cr.bottom,innerHeight-12);
        const available=Math.max(0,bottom-headerBottom-12);
        // Don't open a clipped, unusable panel on a barely visible card.
        if(available<280){close(true);return;}
        const details=qs('.rs-source-details',ui.foreground);
        const detailHeight=details.getBoundingClientRect().height+27;
        const naturalHeight=Math.ceil((panelW-14)*4/3+7+detailHeight);
        const height=Math.min(naturalHeight,available);
        for(const layer of [ui.backdrop,ui.foreground]){
          layer.style.setProperty('--rs-panel-left',`${left-cr.left}px`);
          layer.style.setProperty('--rs-panel-top',`${bottom-height-cr.top}px`);
          layer.style.setProperty('--rs-panel-height',`${height}px`);
        }
        // Reveal all layers together. Cancel this frame if the pointer leaves.
        openFrame=requestAnimationFrame(()=>{
          ui.backdrop.classList.add('HoverCard_open__Pb934','rs-open');
          ui.foreground.classList.add('HoverCard_open__Pb934','rs-open');
        });
        activeController={card,close};
      };

      const open=()=>{
        if(!matchMedia('(min-width:768px) and (hover:hover) and (pointer:fine)').matches)return;
        clearTimeout(closeTimer);clearTimeout(clearTimer);
        // Small anti-accidental-hover delay; once opened every layer appears together.
        if(card.classList.contains('rs-hover-active')&&ui?.foreground.classList.contains('rs-open'))return;
        clearTimeout(openTimer);
        openTimer=setTimeout(openNow,120);
      };

      function close(immediate=false){
        clearTimeout(openTimer);clearTimeout(closeTimer);clearTimeout(clearTimer);cancelAnimationFrame(openFrame);
        if(!ui)return;
        const finish=()=>{
          ui.backdrop.classList.remove('HoverCard_open__Pb934','rs-open');
          ui.foreground.classList.remove('HoverCard_open__Pb934','rs-open');
          const clear=()=>{
            card.classList.remove('rs-hover-active');
            item?.classList.remove('rs-hover-item-active');
            card.closest('.Slider_sliderWrapper__66_q7')?.classList.remove('rs-hover-shelf-active');
            if(activeController?.card===card)activeController=null;
          };
          if(immediate) clear(); else clearTimer=setTimeout(clear,170);
        };
        if(immediate)finish(); else closeTimer=setTimeout(finish,40);
      }

      card.addEventListener('mouseenter',open);
      card.addEventListener('focusin',open);
      card.addEventListener('focusout',e=>{if(!card.contains(e.relatedTarget))close(true)});
      card.addEventListener('mouseleave',()=>close(false));
      card.addEventListener('click',e=>{
        if(!matchMedia('(hover: none), (max-width: 767px)').matches)return;
        if(e.target.closest('a,button'))return;
        if(card.classList.contains('rs-hover-active'))return;
        e.preventDefault();e.stopPropagation();openNow();
      },{passive:false});
    });
    addEventListener('scroll',()=>activeController?.close(true),{passive:true,capture:true});
    addEventListener('resize',()=>activeController?.close(true),{passive:true});
    addEventListener('keydown',e=>{if(e.key==='Escape')activeController?.close(true)});
  }

  function setupLocalRoutes(){ /* BingeBox uses real Netlify routes. */ }

  addEventListener('DOMContentLoaded',()=>{
    resetScroll();
    setupHero();
    setupShelves();
    setupHover();
    setupLocalRoutes();
    document.documentElement.dataset.cloneReady='true';
  });
  addEventListener('load',resetScroll,{once:true});
})();

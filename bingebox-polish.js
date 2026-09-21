(() => {
  const qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  function clean(){
    qsa('body > div:not(#__next):not(.bb-search-overlay),next-route-announcer').forEach(e=>e.remove());
    qsa('#__next > div').filter(e=>!e.querySelector('main')).forEach(e=>e.remove());
    qsa('.ant-modal-root,.ant-popover,.BasicsSpin_shade___COc4,.BasicsSpin_spin__ZMmJP').forEach(e=>e.remove());
    if(matchMedia('(min-width:768px)').matches){
      qsa('.CommonNavigationLayout_to_top_btn__VLUit').forEach(e=>e.remove());
      qsa('button[aria-label="Expand QR code"]').forEach(b=>b.parentElement?.remove());
    }
    const footers=qsa('footer');footers.slice(1).forEach(e=>e.remove());
    const f=footers[0];if(f){f.parentElement.classList.remove('md:hidden');f.innerHTML='<div class="bb-footer-inner"><a href="/" aria-label="BingeBox home" class="bb-footer-brand"><img src="/assets/brand/wordmark-hd.png" alt="BingeBox"></a><p>© '+new Date().getFullYear()+' BingeBox</p><nav aria-label="Footer"><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a><a href="/copyright.html">Copyright &amp; takedown</a><a href="mailto:partnership@bingebox.bond">Contact</a></nav></div>';}
    const hero=document.querySelector('section[aria-label="Featured series"]');
    const thumb=hero?.querySelector('button[aria-label^="Preview "]');if(thumb)thumb.parentElement.classList.add('bb-hero-thumbs');
    const more=qsa('button').find(e=>e.textContent.trim()==='More Movies');if(more){more.textContent='Browse all titles';more.onclick=()=>location.href='/lite';}
    const categories=document.querySelector('[data-bb-scroll]');if(categories){categories.tabIndex=0;categories.setAttribute('role','button');categories.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();categories.click()}});}
    qsa('header button[aria-label="History"]').forEach(e=>{e.setAttribute('aria-label','Browse titles');e.onclick=()=>location.href='/lite'});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',clean,{once:true});else clean();
})();
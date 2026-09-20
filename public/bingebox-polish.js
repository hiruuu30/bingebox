(() => {
  const qs=(s,r=document)=>r.querySelector(s), qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const badHref=(h='')=>/reelshort|crazymaple|\/dashboard|\/shopping/i.test(h);
  function clean(){
    qsa('[aria-hidden="true"].ant-modal-root,.ant-modal-root .ant-modal-hidden,.ant-popover-hidden').forEach(e=>e.remove());
    qsa('a[href]').forEach(a=>{const h=a.getAttribute('href')||'';if(badHref(h)){if(a.closest('footer'))a.remove();else if(!a.closest('.BookItem_bookItem__sK4Qp'))a.removeAttribute('href')}});
    qsa('img[src],source[src]').forEach(e=>{const s=e.getAttribute('src')||'';if(/reelshort|crazymaple/i.test(s)&&!e.closest('.BookItem_bookItem__sK4Qp,.bb-hero-slide'))e.remove()});
    const f=qsa('footer').find(e=>/reelshort|crazy maple|service hours|support/i.test(e.textContent||''));
    if(f)f.innerHTML='<div class="bb-footer-inner"><a class="bb-footer-brand" href="/" aria-label="BingeBox home"><img src="/assets/brand/wordmark-hd.png" alt="BingeBox"></a><p>© 2026 BingeBox. Licensed stories only.</p><nav aria-label="Footer"><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a><a href="/copyright.html">Copyright &amp; takedown</a><a href="mailto:partnership@bingebox.bond">Contact</a></nav></div>';
  }
  const run=()=>{clean();setTimeout(clean,800)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
  new MutationObserver(clean).observe(document.documentElement,{childList:true,subtree:true});
})();

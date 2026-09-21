(() => {
  const FALLBACK = '/assets/brand/mark.svg';
  const cfg = window.BINGEBOX_CONFIG || {};
  const supabaseBase = String(cfg.supabaseUrl || 'https://shffgnuprnycqblpwkrp.supabase.co').replace(/\/$/, '');
  const proxyBase = `${supabaseBase}/functions/v1/poster-proxy`;

  function proxyUrl(raw) {
    try {
      const u = new URL(String(raw || ''), location.href);
      if (u.protocol !== 'https:' || u.hostname !== 'media.bingebox.bond' || !u.pathname.startsWith('/posters/')) return '';
      return `${proxyBase}?url=${encodeURIComponent(u.href)}`;
    } catch { return ''; }
  }

  function isPosterImage(img) {
    const raw = img.currentSrc || img.src || '';
    try {
      const u = new URL(raw, location.href);
      return (u.hostname === 'media.bingebox.bond' && u.pathname.startsWith('/posters/')) ||
        (u.hostname.endsWith('.supabase.co') && /\/storage\/v1\/object\/public\/bingebox-posters-repaired\//.test(u.pathname)) ||
        img.closest?.('.poster-card,.BookItem_bookItem__sK4Qp,.bb-search-card,.bb-hero-slide,.bb-hero-poster,.rs-hero-poster-wrap,.modal-poster,.search-mini,.history-row,.lite-card,.library-card');
    } catch {
      return !!img.closest?.('.poster-card,.BookItem_bookItem__sK4Qp,.bb-search-card,.bb-hero-slide,.bb-hero-poster,.rs-hero-poster-wrap,.modal-poster,.search-mini,.history-row,.lite-card,.library-card');
    }
  }

  function handleError(event) {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !isPosterImage(img)) return;
    const src = img.currentSrc || img.src || '';
    const stage = img.dataset.bbPosterFallback || '';

    if (!stage) {
      const proxied = proxyUrl(src);
      if (proxied && proxied !== src) {
        img.dataset.bbPosterFallback = 'proxy';
        img.removeAttribute('srcset');
        img.src = proxied;
        return;
      }
    }

    if (stage !== 'brand' && !src.endsWith(FALLBACK)) {
      img.dataset.bbPosterFallback = 'brand';
      img.removeAttribute('srcset');
      img.src = FALLBACK;
      img.classList.add('poster-fallback-image');
    }
  }

  document.addEventListener('error', handleError, true);
  window.BBPosterFallback = Object.freeze({ proxyUrl });
})();

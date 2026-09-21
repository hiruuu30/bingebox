(() => {
  const config = window.BINGEBOX_CONFIG || {};
  const PAGE_SIZE = 30;
  const $ = s => document.querySelector(s);
  const grid = $('#liteGrid');
  const status = $('#liteStatus');
  const pageLabel = $('#litePage');
  const prev = $('#litePrev');
  const next = $('#liteNext');
  const form = $('#liteSearchForm');
  const input = $('#liteSearch');
  const clear = $('#liteClear');
  const escapeHTML = (value='') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  let page = 1;
  let total = 0;
  let query = '';

  function readUrlState() {
    const p = new URLSearchParams(location.search);
    page = Math.max(1, Number(p.get('page') || 1) || 1);
    query = String(p.get('q') || '').trim().slice(0,80);
    if (input) input.value = query;
    clear?.classList.toggle('hidden', !query);
  }

  function writeUrlState(replace=false) {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (page > 1) p.set('page', String(page));
    const url = `${location.pathname}${p.toString()?`?${p}`:''}`;
    history[replace?'replaceState':'pushState'](null,'',url);
  }

  function card(d) {
    const slug = encodeURIComponent(d.slug || '');
    const title = escapeHTML(d.title || 'Untitled');
    const poster = escapeHTML(d.poster_url || '/assets/brand/mark.svg');
    const genre = escapeHTML(d.genre || 'Drama');
    return `<a class="lite-card" href="/watch?drama=${slug}&ep=1" aria-label="Watch ${title}">
      <img src="${poster}" alt="${title} poster" loading="lazy" decoding="async" />
      <div class="lite-card-copy">
        <div class="lite-meta"><span>${genre}</span>${d.is_complete?'<span class="complete">Complete</span>':''}${d.is_r18?'<span class="r18">R18</span>':''}</div>
        <h2>${title}</h2>
      </div>
    </a>`;
  }

  function parseTotal(contentRange, fallback) {
    const raw = String(contentRange || '');
    const match = raw.match(/\/(\d+|\*)$/);
    return match && match[1] !== '*' ? Number(match[1]) : fallback;
  }

  function renderRows(rows, count) {
    total = Math.max(0, Number(count) || 0);
    const pages = Math.max(1, Math.ceil(total/PAGE_SIZE));
    grid.innerHTML = rows.length ? rows.map(card).join('') : '<p class="lite-empty">No matching dramas found.</p>';
    const from = total && rows.length ? (page-1)*PAGE_SIZE+1 : 0;
    const to = total && rows.length ? Math.min(from+rows.length-1,total) : 0;
    status.textContent = query ? `${from}–${to} of ${total} matching titles` : `${from}–${to} of ${total} titles`;
    pageLabel.textContent = `Page ${page} / ${pages}`;
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
  }

  async function load() {
    if (!grid) return;
    grid.setAttribute('aria-busy','true');
    status.textContent = 'Loading catalog…';
    prev.disabled = true; next.disabled = true;

    let fallbackShown = false;

    try {
      const snapshotRes = await fetch(config.catalogEndpoint || '/data/catalog.json', {
        headers:{Accept:'application/json'},
        cache:'no-store'
      });
      if (snapshotRes.ok) {
        const payload = await snapshotRes.json();
        let items = Array.isArray(payload) ? payload : payload?.items;
        if (Array.isArray(items) && items.length) {
          const safe = query.toLowerCase();
          if (safe) {
            items = items.filter(d => `${d.title||''} ${d.genre||''} ${Array.isArray(d.mood)?d.mood.join(' '):''}`.toLowerCase().includes(safe));
          }
          const snapshotTotal = items.length;
          const snapshotPages = Math.max(1, Math.ceil(snapshotTotal/PAGE_SIZE));
          if (page <= snapshotPages) {
            const offset = (page-1)*PAGE_SIZE;
            renderRows(items.slice(offset, offset+PAGE_SIZE), snapshotTotal);
            fallbackShown = true;
          }
        }
      }
    } catch {}

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      if (config.backendMode !== 'supabase' || !config.supabaseUrl || !config.supabasePublishableKey) throw new Error('Catalog unavailable.');
      const base = config.supabaseUrl.replace(/\/$/,'');
      const params = new URLSearchParams();
      params.set('published','eq.true');
      params.set('select','id,slug,title,genre,poster_url,is_complete,is_r18,sort_order,created_at');
      params.set('order','sort_order.asc,created_at.desc');
      params.set('limit',String(PAGE_SIZE));
      params.set('offset',String((page-1)*PAGE_SIZE));
      const safeQuery=query.replace(/[*,%]/g,' ').replace(/\s+/g,' ').trim();
      if (safeQuery) params.set('title',`ilike.*${safeQuery}*`);
      const res = await fetch(`${base}/rest/v1/dramas?${params}`, {
        signal:controller.signal,
        headers:{apikey:config.supabasePublishableKey,Accept:'application/json',Prefer:'count=exact'},
        cache:'no-store'
      });
      if (!res.ok) throw new Error('Catalog unavailable.');
      const rows = await res.json();
      const liveTotal = parseTotal(res.headers.get('content-range'), (page-1)*PAGE_SIZE + rows.length);
      const pages = Math.max(1, Math.ceil(liveTotal/PAGE_SIZE));
      if (page > pages) { page = pages; writeUrlState(true); clearTimeout(timer); return load(); }
      renderRows(rows, liveTotal);
    } catch (err) {
      if (!fallbackShown) {
        console.error(err);
        total = 0;
        grid.innerHTML = '<p class="lite-empty">The Lite catalog is temporarily unavailable. Please try again.</p>';
        status.textContent = 'Could not load catalog';
        pageLabel.textContent = 'Page 1';
        prev.disabled = true; next.disabled = true;
      }
    } finally {
      clearTimeout(timer);
      grid.setAttribute('aria-busy','false');
    }
  }

  form?.addEventListener('submit', e => {
    e.preventDefault();
    query = String(input?.value || '').trim().slice(0,80);
    page = 1;
    clear?.classList.toggle('hidden', !query);
    writeUrlState();
    load();
  });
  clear?.addEventListener('click', () => {
    query = ''; page = 1; if (input) input.value=''; clear.classList.add('hidden'); writeUrlState(); load(); input?.focus();
  });
  prev?.addEventListener('click', () => { if (page<=1) return; page--; writeUrlState(); load(); scrollTo({top:0,behavior:'smooth'}); });
  next?.addEventListener('click', () => { const pages=Math.max(1,Math.ceil(total/PAGE_SIZE)); if(page>=pages)return; page++; writeUrlState(); load(); scrollTo({top:0,behavior:'smooth'}); });
  addEventListener('popstate', () => { readUrlState(); load(); });

  readUrlState();
  load();
})();

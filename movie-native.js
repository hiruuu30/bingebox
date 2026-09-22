const app = document.getElementById('app');
const API = '/api/native-movies';
const WATCHLIST_KEY = 'bingebox_movie_watchlist_v1';
let searchTimer = null;

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const yearText = (m) => m.release_year || '—';
const ratingText = (m) => Number(m.rating || 0) > 0 ? Number(m.rating).toFixed(1) : 'NR';
const genresText = (m) => Array.isArray(m.genres) && m.genres.length ? m.genres.slice(0, 3).join(' · ') : 'Movie';
const backdrop = (m) => m?.backdrop_url || m?.poster_url || '';
const poster = (m) => m?.poster_url || m?.backdrop_url || '';

function getWatchlist() {
  try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]').map(Number).filter(Boolean); }
  catch { return []; }
}
function setWatchlist(ids) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...new Set(ids.map(Number).filter(Boolean))]));
}
function isSaved(id) { return getWatchlist().includes(Number(id)); }
function toggleSaved(id) {
  const ids = getWatchlist();
  const n = Number(id);
  const next = ids.includes(n) ? ids.filter(x => x !== n) : [...ids, n];
  setWatchlist(next);
  return next.includes(n);
}

async function api(params = {}) {
  const url = new URL(API, location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('api_' + res.status);
  return res.json();
}

function nav(path) {
  history.pushState({}, '', path);
  renderRoute();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a) return;
  const url = new URL(a.href);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  nav(url.pathname + url.search);
});
window.addEventListener('popstate', renderRoute);

function setLoading() {
  app.innerHTML = '<div class="native-spinner" aria-label="Loading"></div>';
}
function setError(message = 'Something went wrong loading the catalog.') {
  app.innerHTML = '<div class="native-empty"><strong>Unable to load BingeBox Movies.</strong><div class="native-muted" style="margin-top:8px">' + esc(message) + '</div><button class="native-btn native-btn-secondary" style="margin-top:18px" id="retryBtn">Retry</button></div>';
  document.getElementById('retryBtn')?.addEventListener('click', renderRoute);
}

function movieCard(m) {
  const img = poster(m);
  return `<article class="native-card" data-movie-id="${Number(m.tmdb_id)}" tabindex="0" role="link" aria-label="${esc(m.title)}">
    <div class="native-poster">
      ${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <span class="native-rating">★ ${esc(ratingText(m))}</span>
      <button class="native-save-card ${isSaved(m.tmdb_id) ? 'saved' : ''}" type="button" data-save-id="${Number(m.tmdb_id)}" aria-label="Save ${esc(m.title)}">${isSaved(m.tmdb_id) ? '♥' : '♡'}</button>
    </div>
    <div class="native-card-title">${esc(m.title)}</div>
    <div class="native-card-sub">${esc(yearText(m))} · ${esc(genresText(m))}</div>
  </article>`;
}

function bindCards(root = app) {
  root.querySelectorAll('.native-card').forEach(card => {
    const open = (e) => {
      if (e.target.closest('[data-save-id]')) return;
      nav('/movie/' + card.dataset.movieId);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter') open(e);
    });
  });
  root.querySelectorAll('[data-save-id]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const saved = toggleSaved(btn.dataset.saveId);
      btn.textContent = saved ? '♥' : '♡';
      btn.classList.toggle('saved', saved);
    });
  });
}

function section(title, subtitle, items) {
  return `<section class="native-section">
    <div class="native-section-head">
      <div><h2>${esc(title)}</h2>${subtitle ? `<div class="native-muted" style="margin-top:5px">${esc(subtitle)}</div>` : ''}</div>
      <a href="/movies" data-link class="native-text-link">View all</a>
    </div>
    <div class="native-grid">${items.map(movieCard).join('')}</div>
  </section>`;
}

async function renderHome() {
  setLoading();
  try {
    const [recent, rated, stats] = await Promise.all([
      api({ limit: 18, sort: 'recent' }),
      api({ limit: 18, sort: 'rating' }),
      api({ mode: 'stats' })
    ]);
    const hero = rated.items?.[0] || recent.items?.[0];
    if (!hero) {
      app.innerHTML = '<div class="native-empty">The native movie catalog is syncing. Check back shortly.</div>';
      return;
    }
    const heroBg = backdrop(hero);
    app.innerHTML = `
      <section class="native-hero">
        <div class="native-hero-bg" style="background-image:url('${esc(heroBg)}')"></div>
        <div class="native-hero-content">
          <div class="native-kicker">BingeBox Movies · Native catalog</div>
          <h1 class="native-title">${esc(hero.title)}</h1>
          <div class="native-meta">
            <span class="native-pill">${esc(yearText(hero))}</span>
            <span class="native-pill">★ ${esc(ratingText(hero))}</span>
            <span class="native-pill">${esc(genresText(hero))}</span>
          </div>
          <p class="native-copy">${esc(hero.overview || 'Discover movies from the BingeBox catalog.')}</p>
          <div class="native-actions">
            <a href="/movie/${Number(hero.tmdb_id)}" data-link class="native-btn native-btn-primary">▶ Watch now</a>
            <button class="native-btn native-btn-secondary" id="heroSave">${isSaved(hero.tmdb_id) ? '♥ Saved' : '♡ Add to Watchlist'}</button>
          </div>
        </div>
      </section>
      <div class="native-catalog-stat"><strong>${Number(stats.published || 0).toLocaleString()}</strong> movies currently published from <strong>${Number(stats.total || 0).toLocaleString()}</strong> synced catalog records.</div>
      ${section('Recently added', 'Freshly synced to BingeBox', recent.items || [])}
      ${section('Top rated', 'Highly rated picks from the native catalog', rated.items || [])}
    `;
    document.getElementById('heroSave')?.addEventListener('click', (e) => {
      const saved = toggleSaved(hero.tmdb_id);
      e.currentTarget.textContent = saved ? '♥ Saved' : '♡ Add to Watchlist';
    });
    bindCards();
  } catch (e) {
    console.error(e);
    setError();
  }
}

async function renderMovies() {
  setLoading();
  try {
    const data = await api({ limit: 48, sort: 'recent' });
    app.innerHTML = `
      <section class="native-page-head">
        <div class="native-kicker">BingeBox catalog</div>
        <h1 class="native-page-title">Movies</h1>
        <p class="native-page-copy">Browse the native BingeBox movie library. This page is served from our own catalog backend.</p>
      </section>
      <div class="native-toolbar">
        <input id="movieFilter" class="native-search" type="search" placeholder="Filter this page…" autocomplete="off">
        <select id="movieSort" class="native-select" aria-label="Sort movies">
          <option value="recent">Recently added</option>
          <option value="rating">Top rated</option>
          <option value="year">Newest releases</option>
        </select>
      </div>
      <div id="movieGrid" class="native-grid">${(data.items || []).map(movieCard).join('')}</div>
      <div class="native-load-row">
        <button id="loadMore" class="native-btn native-btn-secondary" ${data.nextOffset === null ? 'hidden' : ''}>Load more</button>
      </div>
    `;
    let offset = data.nextOffset;
    let items = data.items || [];
    bindCards();

    document.getElementById('movieFilter')?.addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('#movieGrid .native-card').forEach(card => {
        const title = card.querySelector('.native-card-title')?.textContent?.toLowerCase() || '';
        card.style.display = !q || title.includes(q) ? '' : 'none';
      });
    });

    document.getElementById('movieSort')?.addEventListener('change', async e => {
      const grid = document.getElementById('movieGrid');
      grid.innerHTML = '<div class="native-spinner"></div>';
      const next = await api({ limit: 48, sort: e.target.value });
      items = next.items || [];
      offset = next.nextOffset;
      grid.innerHTML = items.map(movieCard).join('');
      document.getElementById('loadMore').hidden = offset === null;
      bindCards(grid);
    });

    document.getElementById('loadMore')?.addEventListener('click', async e => {
      if (offset === null) return;
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Loading…';
      const sort = document.getElementById('movieSort').value;
      const next = await api({ limit: 48, offset, sort });
      const grid = document.getElementById('movieGrid');
      grid.insertAdjacentHTML('beforeend', (next.items || []).map(movieCard).join(''));
      items.push(...(next.items || []));
      offset = next.nextOffset;
      e.currentTarget.hidden = offset === null;
      e.currentTarget.disabled = false;
      e.currentTarget.textContent = 'Load more';
      bindCards(grid);
    });
  } catch (e) {
    console.error(e);
    setError();
  }
}

async function renderSearch() {
  app.innerHTML = `
    <section class="native-page-head">
      <div class="native-kicker">Find something to watch</div>
      <h1 class="native-page-title">Search</h1>
    </section>
    <div class="native-toolbar"><input id="searchInput" class="native-search native-search-large" type="search" placeholder="Search movies…" autofocus autocomplete="off"></div>
    <div id="searchStatus" class="native-muted">Type a movie title to search the BingeBox catalog.</div>
    <div id="searchGrid" class="native-grid" style="margin-top:20px"></div>
  `;
  const input = document.getElementById('searchInput');
  const grid = document.getElementById('searchGrid');
  const status = document.getElementById('searchStatus');
  const initial = new URL(location.href).searchParams.get('q') || '';
  input.value = initial;

  const run = async () => {
    const q = input.value.trim();
    if (!q) {
      grid.innerHTML = '';
      status.textContent = 'Type a movie title to search the BingeBox catalog.';
      return;
    }
    status.textContent = 'Searching…';
    try {
      const data = await api({ q, limit: 60, sort: 'rating' });
      grid.innerHTML = (data.items || []).map(movieCard).join('');
      status.textContent = data.total ? data.total.toLocaleString() + ' result' + (data.total === 1 ? '' : 's') : 'No movies found.';
      bindCards(grid);
      const u = new URL(location.href);
      u.searchParams.set('q', q);
      history.replaceState({}, '', u.pathname + u.search);
    } catch {
      status.textContent = 'Search is temporarily unavailable.';
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(run, 260);
  });
  if (initial) run();
}

async function renderDetail(id) {
  setLoading();
  try {
    const data = await api({ mode: 'detail', id });
    const m = data.movie;
    const providers = data.playback || [];
    const saved = isSaved(m.tmdb_id);
    app.innerHTML = `
      <section class="native-detail-hero" style="--hero-bg:url('${esc(backdrop(m))}')">
        <div class="native-detail-shade"></div>
        <div class="native-detail">
          <img class="native-detail-poster" src="${esc(poster(m))}" alt="${esc(m.title)} poster" referrerpolicy="no-referrer">
          <div class="native-detail-copy">
            <div class="native-kicker">Movie · ${esc(yearText(m))}</div>
            <h1 class="native-title native-detail-title">${esc(m.title)}</h1>
            <div class="native-meta">
              <span class="native-pill">★ ${esc(ratingText(m))}</span>
              ${m.runtime_minutes ? `<span class="native-pill">${Number(m.runtime_minutes)} min</span>` : ''}
              <span class="native-pill">${esc(genresText(m))}</span>
            </div>
            <p class="native-copy">${esc(m.overview || 'No synopsis is available yet.')}</p>
            <div class="native-actions">
              ${providers.length ? '<button id="playFirst" class="native-btn native-btn-primary">▶ Play</button>' : ''}
              <button id="detailSave" class="native-btn native-btn-secondary">${saved ? '♥ Saved' : '♡ Add to Watchlist'}</button>
            </div>
          </div>
        </div>
      </section>
      ${providers.length ? `
      <section class="native-section">
        <div class="native-section-head"><div><h2>Watch</h2><div class="native-muted" style="margin-top:5px">Choose a playback server. BingeBox does not host the video file.</div></div></div>
        <div class="native-servers" id="servers">
          ${providers.map((p, i) => `<button class="native-server ${i === 0 ? 'active' : ''}" data-provider-index="${i}">${esc(p.name)}</button>`).join('')}
        </div>
        <div class="native-player-wrap">
          <iframe id="playerFrame" class="native-player" title="${esc(m.title)} player" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"></iframe>
        </div>
      </section>` : '<div class="native-empty">No playback provider is configured for this title yet.</div>'}
    `;

    const frame = document.getElementById('playerFrame');
    const setProvider = (i) => {
      if (!frame || !providers[i]) return;
      frame.src = providers[i].url;
      document.querySelectorAll('.native-server').forEach((b, idx) => b.classList.toggle('active', idx === i));
    };
    document.getElementById('playFirst')?.addEventListener('click', () => {
      setProvider(0);
      frame?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    document.querySelectorAll('[data-provider-index]').forEach(btn => btn.addEventListener('click', () => setProvider(Number(btn.dataset.providerIndex))));
    document.getElementById('detailSave')?.addEventListener('click', e => {
      const nowSaved = toggleSaved(m.tmdb_id);
      e.currentTarget.textContent = nowSaved ? '♥ Saved' : '♡ Add to Watchlist';
    });
  } catch (e) {
    console.error(e);
    if (String(e).includes('api_404')) {
      app.innerHTML = '<div class="native-empty"><strong>Movie not found.</strong><div class="native-muted" style="margin-top:8px">This title may still be syncing or is not published yet.</div><a href="/movies" data-link class="native-btn native-btn-secondary" style="margin-top:18px">Browse movies</a></div>';
    } else setError();
  }
}

async function renderWatchlist() {
  const ids = getWatchlist();
  if (!ids.length) {
    app.innerHTML = `<section class="native-page-head"><div class="native-kicker">Your library</div><h1 class="native-page-title">Watchlist</h1></section><div class="native-empty">Your watchlist is empty.<br><a href="/movies" data-link class="native-btn native-btn-secondary" style="margin-top:18px">Browse movies</a></div>`;
    return;
  }
  setLoading();
  const movies = [];
  await Promise.all(ids.slice(0, 40).map(async id => {
    try { movies.push((await api({ mode: 'detail', id })).movie); } catch {}
  }));
  app.innerHTML = `<section class="native-page-head"><div class="native-kicker">Your library</div><h1 class="native-page-title">Watchlist</h1><p class="native-page-copy">Saved locally on this device.</p></section><div class="native-grid">${movies.map(movieCard).join('')}</div>`;
  bindCards();
}

function renderTv() {
  app.innerHTML = `
    <section class="native-page-head">
      <div class="native-kicker">Native BingeBox</div>
      <h1 class="native-page-title">TV Shows</h1>
      <p class="native-page-copy">The movie frontend is now independent. The native TV catalog is the next backend migration, so this route no longer falls back to Bingeflix.</p>
    </section>
    <div class="native-empty"><strong>TV catalog migration in progress.</strong><div class="native-muted" style="margin-top:8px">Movies, search, details and playback are already using the BingeBox backend.</div></div>
  `;
}

async function renderRoute() {
  window.scrollTo({ top: 0, behavior: 'instant' });
  const path = location.pathname.replace(/\/+$/, '') || '/';
  try {
    if (path === '/') return renderHome();
    if (path === '/movies') return renderMovies();
    if (path === '/search') return renderSearch();
    if (path === '/watchlist') return renderWatchlist();
    if (path === '/tv') return renderTv();
    const detail = path.match(/^\/movie\/(\d+)$/);
    if (detail) return renderDetail(detail[1]);
    app.innerHTML = '<div class="native-empty">Page not found.<br><a href="/" data-link class="native-btn native-btn-secondary" style="margin-top:18px">Return home</a></div>';
  } catch (e) {
    console.error(e);
    setError();
  }
}

const themeToggle = document.getElementById('themeToggle');
const storedTheme = localStorage.getItem('bingebox_movie_theme');
if (storedTheme === 'light') document.body.classList.add('native-light');
themeToggle?.addEventListener('click', () => {
  document.body.classList.toggle('native-light');
  localStorage.setItem('bingebox_movie_theme', document.body.classList.contains('native-light') ? 'light' : 'dark');
});

renderRoute();

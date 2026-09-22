const UPSTREAM_ORIGIN = 'https://bingeflix.tv';
const PUBLIC_ORIGIN = 'https://movie.bingebox.bond';

const AD_HOSTS = [
  'acscdn.com',
  'adsterra.com',
  'doubleclick.net',
  'googlesyndication.com',
  'propellerads.com',
  'monetag.com',
  'onclicka.com',
  'popads.net',
  'exoclick.com',
  'juicyads.com'
];

const DROP_RESPONSE_HEADERS = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'report-to',
  'nel',
  'server-timing',
  'cf-ray',
  'cf-cache-status',
  'speculation-rules'
]);

const DROP_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-vercel-forwarded-for',
  'x-vercel-id'
]);

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
}

function replaceBranding(input) {
  return String(input)
    .replace(/https?:\/\/(?:www\.)?bingeflix\.tv/gi, PUBLIC_ORIGIN)
    .replace(/\bBINGEFLIX\b/g, 'BINGEBOX')
    .replace(/\bBingeflix\b/g, 'BingeBox')
    .replace(/\bbingeflix\b/g, 'bingebox')
    .replace(/https?:\/\/discord\.com\/invite\/ajRY6Bn3rr/gi, '/')
    .replace(/https?:\/\/discord\.gg\/ajRY6Bn3rr/gi, '/')
    .replace(/Join our Discord/gi, 'Community')
    .replace(/Join Discord/gi, 'Community')
    .replace(/>Discord</g, '>Community<');
}

function isAdUrl(value) {
  const lower = String(value || '').toLowerCase();
  return AD_HOSTS.some((host) => lower.includes(host));
}

function stripKnownAds(html) {
  return String(html)
    .replace(/<script\b[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi, (tag) => isAdUrl(tag) ? '' : tag)
    .replace(/<link\b[^>]*href=["'][^"']+["'][^>]*>/gi, (tag) => isAdUrl(tag) ? '' : tag)
    .replace(/<iframe\b[^>]*src=["'][^"']+["'][^>]*>[\s\S]*?<\/iframe>/gi, (tag) => isAdUrl(tag) ? '' : tag)
    .replace(/<script\b[^>]*src=["'][^"']*\/cdn-cgi\/scripts\/[^"']*rocket-loader[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*src=["'][^"']*\/cdn-cgi\/scripts\/[^"']*email-decode[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/\sdata-cf-settings=["'][^"']*["']/gi, '')
    .replace(/type=["'][a-f0-9]+-text\/javascript["']/gi, 'type="text/javascript"')
    .replace(/href=["']\/cdn-cgi\/l\/email-protection#[^"']*["']/gi, 'href="#"');
}

function sanitizeHtml(html) {
  let out = stripKnownAds(replaceBranding(html));

  out = out
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>BingeBox Movies — Watch Movies Online</title>')
    .replace(
      /<meta\s+name=["']description["'][^>]*>/i,
      '<meta name="description" content="Browse movies and TV shows on BingeBox Movies"/>'
    )
    .replace(/<link\s+rel=["']icon["'][^>]*>/gi, '<link rel="icon" href="/favicon.ico"/>')
    .replace(/<link\s+rel=["']manifest["'][^>]*>/gi, '<link rel="manifest" href="/manifest.json"/>');

  return out;
}

function sanitizeScript(text) {
  return replaceBranding(text).replace(/https?:\/\/[^"'\s)]+/gi, (url) => isAdUrl(url) ? 'about:blank' : url);
}

function manifestResponse() {
  return new Response(JSON.stringify({
    name: 'BingeBox Movies',
    short_name: 'BingeBox',
    description: 'Browse movies and TV shows on BingeBox Movies',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#09090b',
    icons: []
  }), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=3600'
    }
  });
}

function faviconResponse() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#09090b"/><path d="M17 16h19c9 0 14 4 14 11 0 5-3 8-7 9 6 1 9 5 9 11 0 9-6 13-17 13H17V16zm16 17c5 0 8-2 8-5s-3-5-8-5h-7v10h7zm2 20c6 0 9-2 9-6s-3-6-9-6h-9v12h9z" fill="white"/></svg>';
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=86400, s-maxage=604800'
    }
  });
}

function blockedAdResponse() {
  return new Response('', {
    status: 204,
    headers: {
      'cache-control': 'public, max-age=86400, s-maxage=604800'
    }
  });
}

function buildUpstreamUrl(request) {
  const incoming = new URL(request.url);
  const rawPath = incoming.searchParams.get('path') || '';
  incoming.searchParams.delete('path');

  const cleanPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
  const target = new URL(cleanPath || '/', UPSTREAM_ORIGIN);

  for (const [key, value] of incoming.searchParams.entries()) {
    target.searchParams.append(key, value);
  }
  return target;
}

function requestHeaders(request) {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (!DROP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  }
  headers.set('origin', UPSTREAM_ORIGIN);
  headers.set('referer', UPSTREAM_ORIGIN + '/');
  headers.set('accept-encoding', 'identity');
  return headers;
}

function responseHeaders(upstream, contentType, isHtml) {
  const headers = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    if (!DROP_RESPONSE_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== 'set-cookie') {
      headers.set(key, replaceBranding(value));
    }
  }

  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set(
    'content-security-policy',
    "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; font-src 'self' https: data:; connect-src 'self' https: wss:; media-src 'self' https: blob:; frame-src https:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
  );

  if (contentType) headers.set('content-type', contentType);
  headers.set(
    'cache-control',
    isHtml
      ? 'private, no-cache, no-store, max-age=0, must-revalidate'
      : (upstream.headers.get('cache-control') || 'public, max-age=60, s-maxage=300')
  );
  return headers;
}

async function proxy(request) {
  const incoming = new URL(request.url);
  const requestedPath = '/' + (incoming.searchParams.get('path') || '').replace(/^\/+/, '');

  if (requestedPath === '/manifest.json') return manifestResponse();
  if (requestedPath === '/favicon.ico') return faviconResponse();
  if (requestedPath === '/__blocked-ad.js') return blockedAdResponse();

  const target = buildUpstreamUrl(request);
  const method = request.method.toUpperCase();
  const init = {
    method,
    headers: requestHeaders(request),
    redirect: 'manual'
  };

  if (!['GET', 'HEAD'].includes(method)) {
    init.body = await request.arrayBuffer();
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch {
    return new Response('Movie service temporarily unavailable.', {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get('location');
    const headers = responseHeaders(upstream, upstream.headers.get('content-type'), false);
    if (location) headers.set('location', replaceBranding(location));
    return new Response(null, { status: upstream.status, headers });
  }

  const contentType = upstream.headers.get('content-type') || '';
  const isHtml = contentType.includes('text/html');
  const isScript = /(?:javascript|ecmascript)/i.test(contentType);
  const isJson = /(?:application\/json|application\/manifest\+json)/i.test(contentType);
  const isCss = contentType.includes('text/css');
  const isFlight = contentType.includes('text/x-component') || request.headers.get('rsc') === '1';
  const isText = contentType.startsWith('text/');
  const shouldTransform = isHtml || isScript || isJson || isCss || isFlight || isText;

  const headers = responseHeaders(upstream, contentType, isHtml);

  const getSetCookie = upstream.headers.getSetCookie?.bind(upstream.headers);
  const cookies = getSetCookie ? getSetCookie() : [];
  if (cookies.length) {
    const cleaned = cookies.map((cookie) =>
      replaceBranding(cookie)
        .replace(/;\s*Domain=\.?bingeflix\.tv/gi, '; Domain=movie.bingebox.bond')
    );
    headers.set('set-cookie', cleaned.join(', '));
  }

  if (method === 'HEAD') return new Response(null, { status: upstream.status, headers });

  if (shouldTransform) {
    let text = await upstream.text();
    if (isHtml) text = sanitizeHtml(text);
    else if (isScript) text = sanitizeScript(text);
    else text = replaceBranding(text);
    return new Response(text, { status: upstream.status, headers });
  }

  const body = await upstream.arrayBuffer();
  return new Response(body, { status: upstream.status, headers });
}

export async function GET(request) { return proxy(request); }
export async function HEAD(request) { return proxy(request); }
export async function POST(request) { return proxy(request); }
export async function PUT(request) { return proxy(request); }
export async function PATCH(request) { return proxy(request); }
export async function DELETE(request) { return proxy(request); }
export async function OPTIONS(request) { return proxy(request); }

const UPSTREAM_ORIGIN = 'https://vidnest.fun';
const CLEAN_ORIGIN = 'https://bingebox-movie-omega.vercel.app';

const DROP_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'accept-encoding',
  'origin',
  'referer',
  'x-forwarded-host',
  'x-forwarded-proto'
]);

const DROP_RESPONSE_HEADERS = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'report-to',
  'nel',
  'server-timing',
  'cf-ray',
  'cf-cache-status'
]);

function buildTarget(request) {
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
    if (!DROP_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  headers.set('origin', UPSTREAM_ORIGIN);
  headers.set('referer', UPSTREAM_ORIGIN + '/');
  headers.set('accept-encoding', 'identity');

  return headers;
}

function sanitizeText(text) {
  let out = String(text);

  out = out
    .replaceAll(UPSTREAM_ORIGIN, CLEAN_ORIGIN)
    .replaceAll('https:\\/\\/vidnest.fun', 'https:\\/\\/bingebox-movie-omega.vercel.app');

  // VidNest popup module: neutralize popup/tab creation while keeping playback code intact.
  out = out
    .replace(/\bwindow\.open\s*\(/g, '(()=>null)(')
    .replaceAll('https://hai8g.com/4/11335980', 'about:blank')
    .replaceAll('https:\\/\\/hai8g.com\\/4\\/11335980', 'about:blank');

  // Neutralize the injected ad-loader script used by the provider.
  out = out
    .replaceAll('https://fetch.streaming-1.workers.dev/fetch?url=', 'data:text/javascript,void%200;//')
    .replaceAll('https:\\/\\/fetch.streaming-1.workers.dev\\/fetch?url=', 'data:text/javascript,void%200;//')
    .replaceAll('https://bb.chiripaethenes.com/', 'about:blank/')
    .replaceAll('https:\\/\\/bb.chiripaethenes.com\\/', 'about:blank\\/');

  return out;
}

function responseHeaders(upstream, contentType, isText) {
  const headers = new Headers();

  for (const [key, value] of upstream.headers.entries()) {
    if (!DROP_RESPONSE_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== 'set-cookie') {
      headers.set(key, value);
    }
  }

  if (contentType) headers.set('content-type', contentType);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('access-control-allow-origin', '*');

  if (isText) {
    headers.set('cache-control', 'private, no-cache, no-store, max-age=0, must-revalidate');
    headers.set('pragma', 'no-cache');
    headers.set('expires', '0');
  }

  const getSetCookie = upstream.headers.getSetCookie?.bind(upstream.headers);
  const cookies = getSetCookie ? getSetCookie() : [];
  for (const cookie of cookies) {
    headers.append(
      'set-cookie',
      cookie.replace(/;\s*Domain=\.?vidnest\.fun/gi, '; Domain=bingebox-movie-omega.vercel.app')
    );
  }

  return headers;
}

function rewriteLocation(location) {
  if (!location) return null;

  try {
    const url = new URL(location, UPSTREAM_ORIGIN);
    if (url.origin === UPSTREAM_ORIGIN) {
      return CLEAN_ORIGIN + url.pathname + url.search + url.hash;
    }
    return location;
  } catch {
    return location;
  }
}

async function proxy(request) {
  const method = request.method.toUpperCase();
  const target = buildTarget(request);

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
  } catch (error) {
    console.error('vidnest-clean fetch failed', target.toString(), error);
    return new Response('Player temporarily unavailable.', {
      status: 502,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store'
      }
    });
  }

  const contentType = upstream.headers.get('content-type') || '';
  const isText =
    contentType.startsWith('text/') ||
    /javascript|ecmascript|json|xml|svg/i.test(contentType);

  const headers = responseHeaders(upstream, contentType, isText);

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = rewriteLocation(upstream.headers.get('location'));
    if (location) headers.set('location', location);
    return new Response(null, { status: upstream.status, headers });
  }

  if (method === 'HEAD') {
    return new Response(null, { status: upstream.status, headers });
  }

  if (isText) {
    const text = sanitizeText(await upstream.text());
    return new Response(text, { status: upstream.status, headers });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers
  });
}

export async function GET(request) { return proxy(request); }
export async function HEAD(request) { return proxy(request); }
export async function POST(request) { return proxy(request); }
export async function PUT(request) { return proxy(request); }
export async function PATCH(request) { return proxy(request); }
export async function DELETE(request) { return proxy(request); }
export async function OPTIONS(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': '*'
      }
    });
  }
  return proxy(request);
}

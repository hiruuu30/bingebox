const ALLOWED_HOST = 'akamai-static.shorttv.live';
const ALLOWED_PREFIX = '/hls-encrypted/';

function corsHeaders(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,HEAD,OPTIONS',
    'access-control-allow-headers': 'Range,Accept,Content-Type',
    ...extra,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    }),
  });
}

function approved(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== ALLOWED_HOST) return null;
    if (!url.pathname.startsWith(ALLOWED_PREFIX)) return null;
    return url;
  } catch {
    return null;
  }
}

function proxied(url, requestUrl) {
  const base = new URL(requestUrl);
  return base.origin + '/api/shortmax-hls?url=' + encodeURIComponent(url.toString());
}

function rewriteManifest(text, sourceUrl, requestUrl) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_m, value) => {
          try {
            const absolute = new URL(value, sourceUrl);
            return 'URI="' + proxied(absolute, requestUrl) + '"';
          } catch {
            return _m;
          }
        });
      }
      try {
        return proxied(new URL(trimmed, sourceUrl), requestUrl);
      } catch {
        return line;
      }
    })
    .join('\n');
}

async function handle(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const requestUrl = new URL(request.url);
  const source = approved(requestUrl.searchParams.get('url') || '');
  if (!source) return json({ ok: false, error: 'invalid_shortmax_hls_url' }, 400);

  const headers = {
    'user-agent': 'Mozilla/5.0 (compatible; BingeBox-HLS/1.0)',
    accept: request.headers.get('accept') || '*/*',
  };
  const range = request.headers.get('range');
  if (range) headers.range = range;

  let upstream;
  try {
    upstream = await fetch(source, {
      method: request.method,
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    return json({ ok: false, error: 'upstream_fetch_failed' }, 502);
  }

  if (!upstream.ok && upstream.status !== 206) {
    await upstream.body?.cancel().catch(() => {});
    return json({ ok: false, error: 'upstream_' + upstream.status }, upstream.status);
  }

  const type = (upstream.headers.get('content-type') || '').toLowerCase();
  const isManifest = source.pathname.toLowerCase().endsWith('.m3u8') ||
    type.includes('mpegurl');

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: upstream.status,
      headers: corsHeaders({
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        'cache-control': isManifest
          ? 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800'
          : 'public, max-age=31536000, s-maxage=31536000, immutable',
      }),
    });
  }

  if (isManifest) {
    const text = await upstream.text();
    const rewritten = rewriteManifest(text, source, request.url);
    return new Response(rewritten, {
      status: 200,
      headers: corsHeaders({
        'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'cache-control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800',
      }),
    });
  }

  const outHeaders = corsHeaders({
    'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, s-maxage=31536000, immutable',
  });
  for (const name of ['content-range', 'accept-ranges', 'content-length', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) outHeaders[name] = value;
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

export async function GET(request) { return handle(request); }
export async function HEAD(request) { return handle(request); }
export async function OPTIONS(request) { return handle(request); }

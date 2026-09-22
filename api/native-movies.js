const EDGE_API = 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/movie-public-api';

function response(body, status = 200, cache = 'public, max-age=30, s-maxage=120, stale-while-revalidate=3600') {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache,
      'x-content-type-options': 'nosniff'
    }
  });
}

export async function GET(request) {
  try {
    const incoming = new URL(request.url);
    const target = new URL(EDGE_API);
    for (const [key, value] of incoming.searchParams.entries()) target.searchParams.append(key, value);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const upstream = await fetch(target, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store'
    }).finally(() => clearTimeout(timer));

    const text = await upstream.text();
    if (!upstream.ok) {
      return response(JSON.stringify({ error: 'catalog_unavailable' }), upstream.status >= 500 ? 503 : upstream.status, 'no-store');
    }

    return response(text, 200);
  } catch (error) {
    console.error('native-movies', error);
    return response(JSON.stringify({ error: 'catalog_unavailable' }), 503, 'no-store');
  }
}

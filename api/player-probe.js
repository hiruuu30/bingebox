const PROVIDERS = [
  { id: 'VIDSRC', name: 'Server 1', url: 'https://vidsrc-embed.ru/embed/movie/238' },
  { id: 'EMBED_SU', name: 'Server 2', url: 'https://vidfast.vc/movie/238?autoplay=true' },
  { id: 'VIDLINK', name: 'Server 3', url: 'https://1embed.cc/embed/movie/238' },
  { id: 'AUTOEMBED', name: 'Server 4', url: 'https://vidnest.fun/movie/238?1=1' },
  { id: 'CINEVERSE', name: 'Server 5', url: 'https://chillflix.pw/embed/movie/238?autoplay=true' }
];

const TERMS = [
  'window.open','popunder','popads','onclick','target=_blank','target="_blank"',
  'adsterra','monetag','propeller','aclib','acscdn','doubleclick','googlesyndication',
  'disable sandbox','sandbox','popup','adsbygoogle'
];

function scripts(html) {
  return [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(m => m[1]).slice(0, 30);
}

export async function GET() {
  const results = [];
  for (const p of PROVIDERS) {
    try {
      const res = await fetch(p.url, {
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
          'referer': 'https://movie.bingebox.bond/',
          'accept': 'text/html,application/xhtml+xml'
        }
      });
      const text = await res.text();
      const lower = text.toLowerCase();
      results.push({
        id: p.id,
        name: p.name,
        status: res.status,
        finalUrl: res.url,
        contentType: res.headers.get('content-type'),
        length: text.length,
        hits: TERMS.filter(t => lower.includes(t.toLowerCase())),
        scripts: scripts(text),
        iframeCount: (text.match(/<iframe\b/gi) || []).length,
        formCount: (text.match(/<form\b/gi) || []).length
      });
    } catch (error) {
      results.push({ id: p.id, name: p.name, error: String(error) });
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

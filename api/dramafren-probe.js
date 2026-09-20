export default async function handler(req, res) {
  const hostKey = String(req.query?.host || 'dramabox').toLowerCase();
  const mode = String(req.query?.mode || 'home').toLowerCase();
  const hosts = {
    dramabox: 'dramabox.dramafren.org',
    dramaboxv2: 'dramaboxv2.dramafren.org'
  };
  const host = hosts[hostKey];
  if (!host) return res.status(400).json({ error: 'host must be dramabox or dramaboxv2' });

  const paths = {
    home: '/',
    detail: '/index.php?id=42000005465&lang=en&view=detail',
    watch: '/index.php?ep=1&id=42000005808&lang=en&view=watch',
    robots: '/robots.txt',
    sitemap: '/sitemap.xml'
  };
  const path = paths[mode];
  if (!path) return res.status(400).json({ error: 'mode must be home, detail, watch, robots, or sitemap' });
  const target = `https://${host}${path}`;

  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BingeBoxSync/1.0; +https://bingebox.bond)',
        'Accept': mode === 'robots' || mode === 'sitemap' ? 'text/plain,application/xml,text/xml,*/*' : 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
        'Cache-Control': 'no-cache'
      },
      signal: AbortSignal.timeout(12000)
    });

    const raw = await upstream.text();
    const body = raw.slice(0, 131072);
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
    const cloudflareChallenge = /cf-chl-|challenge-platform|Just a moment|Attention Required/i.test(body);
    const hrefCount = (body.match(/<a\b[^>]*href\s*=/gi) || []).length;

    return res.status(200).json({
      ok: upstream.ok,
      host: hostKey,
      mode,
      upstream_status: upstream.status,
      final_url: upstream.url,
      content_type: upstream.headers.get('content-type'),
      server: upstream.headers.get('server'),
      cf_ray: upstream.headers.get('cf-ray'),
      body_bytes: raw.length,
      title,
      href_count: hrefCount,
      cloudflare_challenge: cloudflareChallenge,
      sample: (mode === 'robots' || mode === 'sitemap') ? body.slice(0, 500) : undefined
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      host: hostKey,
      mode,
      error: error?.message || String(error)
    });
  }
}

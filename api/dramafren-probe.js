export default async function handler(req, res) {
  const mode = String(req.query?.mode || 'home').toLowerCase();
  const targets = {
    home: 'https://dramabox.dramafren.org/',
    detail: 'https://dramabox.dramafren.org/index.php?id=42000005465&lang=en&view=detail',
    watch: 'https://dramabox.dramafren.org/index.php?ep=1&id=42000005808&lang=en&view=watch'
  };
  const target = targets[mode];
  if (!target) return res.status(400).json({ error: 'mode must be home, detail, or watch' });

  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BingeBoxSync/1.0; +https://bingebox.bond)',
        'Accept': 'text/html,application/xhtml+xml',
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
      upstream_status: upstream.status,
      final_url: upstream.url,
      content_type: upstream.headers.get('content-type'),
      server: upstream.headers.get('server'),
      cf_ray: upstream.headers.get('cf-ray'),
      body_bytes: raw.length,
      title,
      href_count: hrefCount,
      cloudflare_challenge: cloudflareChallenge
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
}

/**
 * BingeBox automated sync heartbeat.
 *
 * Vercel Cron calls this route. The existing Supabase cloud-importer remains
 * responsible for discovery, normalization, deduplication, source probing,
 * and resumable database writes. This route only wakes that worker repeatedly
 * for a bounded amount of time.
 */
const DEFAULT_SUPABASE_URL = 'https://shffgnuprnycqblpwkrp.supabase.co';
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_PeopMn9aiDdzxqLvSkkR6w_PUw9BIJH';
const DEFAULT_WORKER = `${DEFAULT_SUPABASE_URL}/functions/v1/cloud-importer?action=work`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

function authorized(request) {
  const secret = process.env.CRON_SECRET || process.env.BINGEBOX_SYNC_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

function numberEnv(name, fallback, min, max) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

async function runWorker(workerUrl, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: '{}',
      cache: 'no-store',
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    return {
      ok: response.ok && data?.ok !== false,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 599,
      elapsedMs: Date.now() - startedAt,
      error: error?.name === 'AbortError' ? 'worker_timeout' : String(error?.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request) {
  if (!authorized(request)) {
    return json({
      ok: false,
      error: process.env.CRON_SECRET || process.env.BINGEBOX_SYNC_SECRET
        ? 'unauthorized'
        : 'sync_secret_not_configured',
    }, process.env.CRON_SECRET || process.env.BINGEBOX_SYNC_SECRET ? 401 : 503);
  }

  const workerUrl = process.env.BINGEBOX_SYNC_WORKER_URL || DEFAULT_WORKER;
  const publishableKey = process.env.BINGEBOX_SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY;
  const ticks = numberEnv('BINGEBOX_SYNC_TICKS', 4, 1, 8);
  const timeoutMs = numberEnv('BINGEBOX_SYNC_TIMEOUT_MS', 50000, 5000, 55000);
  const results = [];
  const startedAt = Date.now();

  for (let i = 0; i < ticks; i += 1) {
    const result = await runWorker(workerUrl, {
      accept: 'application/json',
      apikey: publishableKey,
      'content-type': 'application/json',
      'x-bingebox-sync-heartbeat': 'vercel-cron',
    }, timeoutMs);
    results.push({ tick: i + 1, ...result });

    if (!result.ok || result.data?.idle === true) break;
  }

  const failed = results.find((result) => !result.ok);
  return json({
    ok: !failed,
    service: 'bingebox-sync',
    mode: 'supabase-cloud-importer-heartbeat',
    ticksRun: results.length,
    elapsedMs: Date.now() - startedAt,
    results,
  }, failed ? 502 : 200);
}

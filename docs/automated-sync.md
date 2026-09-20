# BingeBox automated sync

The production sync path is:

`DramaFren → Supabase cloud-importer → normalized BingeBox tables → episode-source relay → website`

The importer already owns discovery, metadata normalization, duplicate checks, resumable item processing, source verification, and error reporting. The Vercel route `/api/bingebox-sync` is only a bounded heartbeat that wakes the importer after the browser is closed.

## Required Vercel environment variable

Set this in the BingeBox Vercel project for Production:

`CRON_SECRET=<long-random-secret>`

The route rejects requests when the secret is missing or incorrect. Do not place this secret in frontend code.

Optional variables:

- `BINGEBOX_SYNC_TICKS`: worker ticks per cron invocation, default `4`, maximum `8`
- `BINGEBOX_SYNC_TIMEOUT_MS`: per-tick timeout, default `50000`
- `BINGEBOX_SYNC_WORKER_URL`: override the Supabase cloud-importer worker URL
- `BINGEBOX_SUPABASE_PUBLISHABLE_KEY`: override the publishable key sent to the worker

## Schedule

Vercel runs the heartbeat every ten minutes from `vercel.json`. Each invocation processes sequential worker ticks and stops early when the queue is idle. This prevents one malformed item from blocking later items and avoids launching a second worker from inside the scheduler.

## Operational check

After setting `CRON_SECRET`, call:

`GET /api/bingebox-sync`

with:

`Authorization: Bearer <same-secret>`

A healthy response reports the tick results and whether the queue was idle. A `502` means the importer returned an error or timed out; inspect the existing `cloud_import_jobs` and `cloud_import_items` records in the BingeBox workspace.

The heartbeat does not publish browser-seeded content without the existing rights and publication rules. It only advances jobs already accepted by the Supabase importer.

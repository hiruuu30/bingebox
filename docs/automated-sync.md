# Episode sync and delivery — operational status

Updated 2026-09-20. Frontend frozen at d1be94ceca4c69e6a921b12c389f0734998aabd3.

## What actually runs
Supabase pg_cron advances accepted import jobs; Vercel has no cron schedule.
- bingebox-cloud-importer: each minute, only when pending/running server_fetch jobs exist.
- bingebox-cloud-seed-importer: each minute, only when seeded browser_seed jobs exist.
- Duplicate bingebox-cloud-importer-heartbeat disabled.
- bingebox-expire-sources: every ten minutes, retires external URLs with elapsed expires_at.
This is queue processing, NOT recurring source discovery, existing-title reconciliation, URL refresh, or transfer to R2. Existing titles are skipped by server_fetch. Do not advertise this as a working automatic library refresh.

## Verified blockers
All three stored server_fetch jobs failed with source HTTP 403 before discovery.
A fresh DramaFren probe returned a Cloudflare challenge. Resolve through authorized provider access/feed; do not retry indefinitely.
3,355 active sources share hwztakavideo.dramaboxdb.com. A representative episode's origin failed DNS resolution from pg_net and external-media returned 502. This is a backend observation, not a global DNS finding. These sources have not been bulk disabled based on one hostname probe.
151 active sources had expired timestamps; retired without deleting records. Current active-expired count: zero.
Source recovery requires current reusable URLs or owned/licensed media. A timer cannot manufacture replacement URLs.

## Delivery / egress
external-media still streams MP4 bodies and HLS segments through Supabase, which counts as Supabase egress. Moving cron to Supabase does not eliminate that.
The legacy R2 path uses the configured Cloudflare /token endpoint and serves signed media directly from media.bingebox.bond. One representative token request returned 200 and signed Range request returned 206 video/mp4. Unsigned media returning 403 is expected.
For low Supabase video egress, deliver video directly through R2/Cloudflare and use Supabase for metadata and authorization. R2 direct egress is free, but storage/operations and Worker usage are not necessarily free.
https://supabase.com/docs/guides/platform/manage-your-usage/egress
https://developers.cloudflare.com/r2/pricing/

## Backend repair
cloud-importer v2 isolates server_fetch jobs from browser_seed jobs and bounds media verification reads even if an origin ignores Range. HTML error pages are rejected; encrypted or incomplete HLS manifests are not accepted as verified reusable sources. Redirects during verification are rejected rather than fetched without validation.
Admin authorization and draft/rights verification behavior remain intact. The existing public worker endpoint remains unchanged.
Operational SQL is in supabase/operations/20260920_sync_repair.sql. Reapplying is safe; queue commands retain existing credentials in the database.
Original deployed source is retained under supabase/rollback/cloud-importer-v1/ for rollback.
Validation: syntax parse; bounded-read cancellation, HTML rejection, mixed encrypted HLS rejection, clear HLS acceptance, queue-mode selection; live cron/data checks and signed R2 HTTP probes.
Remaining work: accessible provider feed, recurring reconciliation/refresh, queue concurrency and crash-resume handling, and moving external media delivery away from the Supabase relay after replacement media access exists.

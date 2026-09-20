# Episode sync and delivery — operational status

Updated 2026-09-21. Frontend frozen at d1be94ceca4c69e6a921b12c389f0734998aabd3. Do not modify frontend files while this backend repair is in progress.

## What runs now
Supabase owns scheduling and queue processing; Vercel has no cron schedule.
- bingebox-cloud-importer: each minute, queue-gated for pending/running server_fetch jobs.
- bingebox-cloud-seed-importer: each minute, queue-gated for seeded browser_seed jobs.
- bingebox-expire-sources: every ten minutes, retires elapsed temporary sources.
- bingebox-sync-scheduler: every fifteen minutes, reconciles configured sync targets and enqueues due server_fetch jobs.
- Duplicate bingebox-cloud-importer-heartbeat remains disabled.

The server_fetch worker is cloud-importer v4. Jobs are claimed through claim_bingebox_cloud_import_job() with FOR UPDATE SKIP LOCKED and a time-bounded lease. A crashed worker can be reclaimed after lease expiry; concurrent invocations cannot claim the same active lease.

Sync targets live in public.bingebox_sync_targets and use failure backoff. Repeated DramaFren HTTP 403 failures auto-pause the target rather than retrying indefinitely. The current dramabox.dramafren.org target was given one bounded verification attempt on 2026-09-21, failed with HTTP 403, reached three consecutive failures, and is now automatically disabled with zero pending/running jobs.

## Existing-title reconciliation
cloud-importer v4 no longer immediately marks an existing title as skipped_duplicate. When a reachable provider page is available, it scans the provider episode list and reconciles it against the existing drama:
- R2-backed episodes (video_key present) are left untouched.
- Missing episode rows are created as drafts.
- Existing external/direct sources are refreshed by stable host+path fingerprint when a fresh reusable URL is found.
- Missing external/direct sources can be added without replacing the existing title.
- Episode video_url is repointed to the verified relay only for episodes that do not have video_key.

This path is deployed and compiles, but cannot be exercised end to end against DramaFren while the provider still returns HTTP 403. Do not call provider reconciliation restored until a reachable authorized feed/source is available and a live existing-title update completes.

## Verified blockers
DramaFren still returns HTTP 403 before discovery from the backend. The latest bounded scheduled attempt failed the same way and the target auto-paused.
3,355 active sources share hwztakavideo.dramaboxdb.com. Previous backend probes failed DNS resolution for that hostname. These rows have not been mass-deleted based on a single backend DNS observation.
A timer or queue cannot manufacture replacement media URLs. Restoring the non-R2 library requires a reachable authorized provider feed/source or owned/licensed media files.

## Delivery / egress
Live inventory on 2026-09-21:
- 3,913 published episodes.
- 116 published episodes have video_key and an active priority-1 legacy_r2 source.
- 3,797 published episodes have no R2 video_key.
- 3,355 active external/direct sources point at hwztakavideo.dramaboxdb.com.

The existing signed R2 path is verified end to end. For a representative published episode, the Cloudflare token endpoint returned HTTP 200 with a fresh signed media.bingebox.bond URL, then a Range bytes=0-0 request returned HTTP 206 video/mp4 with Content-Range bytes 0-0/9386583. Those 116 episodes fetch video bytes directly from Cloudflare/R2, not through Supabase video streaming.

external-media still streams non-R2 MP4/HLS bodies through a Supabase Edge Function, so any working external source delivered through that relay consumes Supabase egress. No bulk R2 transfer was attempted because the affected upstream media is currently unreachable and the existing upload Worker exposes the authenticated browser PUT contract, not a verified server-to-server import contract. Preserve the signed R2 access-control flow rather than inventing a second media contract.

For low Supabase video egress, the target architecture remains: Supabase for metadata/authorization; Cloudflare/R2 for video bytes.
https://supabase.com/docs/guides/platform/manage-your-usage/egress
https://developers.cloudflare.com/r2/pricing/

## Backend repair history
2026-09-20:
- cloud-importer v2 isolated server_fetch from browser_seed work.
- Media verification reads were bounded; HTML responses, encrypted/incomplete HLS, and unsafe redirects were rejected.
- Duplicate heartbeat disabled; queue gates and expiry cleanup installed.
- Original v1 source retained under supabase/rollback/cloud-importer-v1/.

2026-09-21:
- supabase/migrations/20260921_sync_orchestrator.sql adds crash-safe leasing, recurring target scheduling, failure backoff, and auto-pause.
- supabase/migrations/20260921_sync_orchestrator_indexes.sql indexes sync-target job references.
- cloud-importer v3 switched worker selection to atomic lease claims.
- cloud-importer v4 added existing-title episode/source reconciliation while preserving R2-backed episodes.
- Live worker smoke check returned HTTP 200 {"ok":true,"idle":true} after the blocked target was reconciled and paused.
- Frontend files were not changed.

## Remaining work
Playback/sync is not fully restored. The remaining hard dependency is replacement media access for the 3,797 non-R2 published episodes. Once a reachable authorized source/feed is supplied, validate in this order:
1. re-enable/configure the relevant bingebox_sync_targets row;
2. verify discovery succeeds;
3. verify an existing title reconciles a new/refreshed episode end to end;
4. verify source health and playback;
5. implement/verify a server-to-server R2 ingest path using the existing key/token access model;
6. migrate recoverable episodes to R2, then retire their Supabase relay routes.

Do not claim full playback or automated sync restoration until steps 2-4 succeed against live provider data and the affected library has usable media.

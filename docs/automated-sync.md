# Episode sync and delivery — operational status

Updated 2026-09-21.

Frontend layout and user-facing behavior remain unchanged. The user later permitted frontend changes if they become necessary, but no layout/behavior changes were needed for the backend repair described here.

## Current public catalog
The live catalog is intentionally limited to verified R2-backed media:
- 3 published dramas.
- 116 published episodes.
- 116/116 published episodes have `video_key`.
- 0 published external-only episodes.

The three published dramas are:
- Hero Husband's Apocalypse Harem — 61 episodes.
- You Got the Wrong Guy — 50 episodes.
- Blind to Love: the Alpha's Secret Heir — 5 episodes.

All other legacy titles remain stored but unpublished in the reversible quarantine described below.

## What runs now
Supabase owns scheduling and queue processing; Vercel has no production cron schedule for sync.

- `bingebox-cloud-importer`: each minute, queue-gated for pending/running `server_fetch` jobs.
- `bingebox-cloud-seed-importer`: each minute, queue-gated for seeded `browser_seed` jobs.
- `bingebox-expire-sources`: every ten minutes, retires elapsed temporary sources.
- `bingebox-sync-scheduler`: every fifteen minutes, reconciles configured direct sync targets and enqueues due jobs.
- `bingebox-dramafren-metadata-sync`: every minute, queue-gated for due DramaFren metadata discovery/refresh work.
- `bingebox-dramafren-home-seed`: every six hours at minute 17, seeds the public Webfic/DramaBox home shelves into the metadata queue.
- Duplicate `bingebox-cloud-importer-heartbeat` remains disabled.

The `cloud-importer` worker is v4. Server-fetch jobs are claimed through `claim_bingebox_cloud_import_job()` with `FOR UPDATE SKIP LOCKED` and a time-bounded lease. A crashed worker can be reclaimed after lease expiry and concurrent invocations cannot claim the same active lease.

## DramaFren: dramabox.dramafren.org
Direct backend HTML fetching is still blocked by Cloudflare:
- Supabase server-fetch attempts receive HTTP 403 before discovery.
- A temporary Vercel runtime probe independently received the same HTTP 403 / "Just a moment" challenge for home, detail, and watch pages.
- The temporary Vercel probe endpoint was removed after verification.
- No CAPTCHA, Cloudflare challenge, signed-app API, or paywall bypass is used.

The original `https://dramabox.dramafren.org/` direct sync target reached three bounded HTTP 403 failures and is automatically paused. There are no pending/running jobs repeatedly hammering it.

### Public metadata route
A separate metadata-only pipeline is working through ordinary unsigned Webfic endpoints used by the DramaBox web client:
- `POST https://www.webfic.com/webfic/book/detail` with `pline: DRAMABOX` returns title metadata, poster, synopsis, tags, shelf date, chapter count, and recommendations.
- `POST https://www.webfic.com/webfic/home/index` with the same public web headers returns public home-shelf metadata.
- `/webfic/book/detail/v2` was tested with current and older IDs and currently returns success without a useful data payload, so it is not used.
- Protected/signed mobile-app chapter APIs are not used.

Metadata work is stored in `public.dramafren_catalog_queue` and claimed atomically through `claim_dramafren_catalog_item()`.

The metadata worker:
- validates numeric book IDs;
- generates the canonical `dramabox.dramafren.org` detail URL;
- stores current title/poster/description/tags/chapter count/shelf time;
- follows English recommendation IDs to a bounded depth of 3;
- links exact-title matches to existing BingeBox dramas when one exists;
- retries failures with exponential backoff;
- refreshes ready records every 12 hours;
- never publishes a title merely because metadata was discovered.

Verified fresh September 2026 seeds include:
- `42000024547` — My Billionaire Patient Is My Baby Daddy — 45 episodes.
- `42000026687` — The Zero-Talent Nanny Raised Beast Kings — 50 episodes.
- `42000027224` — The Heirless Alpha's Miracle Omega — 53 episodes.
- `42000027388` — Brains! Love! Success! She Takes It All! — 55 episodes.
- `42000027425` — My Client's Son Wants Me—and He's Half My Age — 30 episodes.

The first public-home seed returned 25 shelf items and added 19 previously unseen queue records after deduplication. After the verification burst, the queue contained 31 records and all 31 were `ready` with zero failed items. None had an exact-title match to the 78 quarantined legacy dramas.

A live refresh test on book `42000027388` reclaimed the ready row, returned the same 55-episode count, and scheduled its next refresh exactly 12 hours later.

### Current limitation of metadata sync
The verified public Webfic endpoints do not expose usable current chapter media URLs. Public `detail/v2` produced no chapter-list payload, and an inspected public sample player used hard-coded demo MP4s rather than a real catalog stream endpoint.

Therefore the metadata pipeline can automatically discover and refresh title metadata and episode counts, but it does not yet make newly discovered titles playable. New titles remain staged and unpublished until media is obtained through a reachable authorized source.

## Existing-title reconciliation
`cloud-importer` v4 no longer immediately marks an existing title as `skipped_duplicate`. When a reachable provider page is available, it reconciles against the existing drama:
- R2-backed episodes (`video_key` present) are left untouched.
- Missing episode rows are created as drafts.
- Existing external/direct sources can be refreshed by stable host+path fingerprint.
- Missing external/direct sources can be added without replacing the existing title.
- `episode.video_url` is changed only for episodes without `video_key`.

This path is deployed, but direct DramaFren HTML cannot exercise it while the provider returns HTTP 403.

## Delivery / egress
The currently published catalog no longer depends on the Supabase `external-media` relay for video bytes.

The signed R2 flow has been verified repeatedly:
1. the Cloudflare token endpoint returns HTTP 200 with a signed `media.bingebox.bond` URL;
2. a byte-range request to that URL returns HTTP 206 `video/mp4`;
3. the video body is served by Cloudflare/R2 rather than streamed through Supabase.

After the clean reset, episode 1 from every surviving title was checked:
- Blind to Love: the Alpha's Secret Heir — `bytes 0-0/14134921`.
- You Got the Wrong Guy — `bytes 0-0/17980511`.
- Hero Husband's Apocalypse Harem — `bytes 0-0/13883793`.

`external-media` remains deployed for future external sources. If it streams MP4/HLS bodies, those bytes count as Supabase egress. The target architecture remains Supabase for metadata/authorization and Cloudflare/R2 for video bytes.

## Clean live-library reset
A reversible quarantine was applied rather than deleting the old library.

- 78 published dramas with no published R2-backed episode were set unpublished.
- 3,797 episodes under those dramas were snapshotted and set unpublished.
- Source records and original episode rows were preserved.
- Hero highlight setting remains `[]`, so the unchanged frontend automatically selects from the surviving published catalog.

Quarantine batch:
`4eedac8d-a329-4223-9d64-94db1faf6e7f`

Migration:
`supabase/migrations/20260921_quarantine_unplayable_library.sql`

Manual rollback:
`supabase/operations/20260921_restore_quarantined_library.sql`

Do not run the rollback until replacement media is reachable and verified.

## Backend repair history
### 2026-09-20
- `cloud-importer` v2 isolated `server_fetch` from `browser_seed` work.
- Media verification reads were bounded.
- HTML responses, encrypted/incomplete HLS, and unsafe redirects were rejected.
- Duplicate heartbeat disabled.
- Queue gates and expiry cleanup installed.
- Original v1 source retained under `supabase/rollback/cloud-importer-v1/`.

### 2026-09-21
- Added crash-safe job leasing, recurring target scheduling, failure backoff, and auto-pause.
- `cloud-importer` v3 switched worker selection to atomic lease claims.
- `cloud-importer` v4 added existing-title episode/source reconciliation.
- Added reversible clean-library quarantine.
- Added `dramafren_catalog_queue`, bounded recommendation discovery, atomic claiming, recurring refresh, and exact-title linking.
- Deployed `dramafren-metadata-sync` v2.
- Added minute-level queue-gated metadata processing and six-hour public-home seeding.
- Removed the temporary Vercel DramaFren probe after confirming the same Cloudflare 403.
- Frontend layout/behavior files were not changed.

## Remaining work
Playback and full media sync are not restored for the newly discovered DramaFren catalog.

The remaining hard dependency is a reachable authorized media source for those titles. When one becomes available:
1. map media to the staged `book_id` and chapter/episode numbers;
2. verify the media source without bypassing access controls;
3. reconcile/create episode rows as drafts;
4. transfer recoverable licensed media to R2 using the existing key/token access model;
5. verify signed R2 byte-range playback;
6. publish only after rights/source verification succeeds.

Do not claim full DramaFren playback restoration until newly discovered titles have verified playable media.

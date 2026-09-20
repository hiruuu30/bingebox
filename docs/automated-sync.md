# BingeBox automated sync — production status

Updated 2026-09-21.

## Current architecture
BingeBox now follows the Animori production pattern:

```
DramaBox/Webfic source adapters
        ↓
Supabase scanner / discovery
        ↓
source_sync_state + fingerprints
        ↓
sync_queue
        ↓
dramafren-sync-worker
        ↓
normalized PostgreSQL
        ↓
BingeBox frontend
```

Discovery, episode resolution, media validation and publishing state are separated. Queue jobs use deterministic idempotency keys, atomic `FOR UPDATE SKIP LOCKED` claims, worker leases, retry/backoff and stale-worker recovery.

Frontend layout and behavior were not changed.

## Source adapters

### Catalog / metadata
The primary discovery source is the public DramaBox/Webfic browse feed:

- `POST https://www.webfic.com/webfic/home/browse`
- `pline: DRAMABOX`
- `language: en`
- `{ typeTwoId: 0, pageNo: N, pageSize: 100 }`

It currently exposes 30 pages / about 3,000 English titles with book ID, title, poster, synopsis, tags, shelf time and episode count.

`dramafren-catalog-sync`:
- scans the latest 500 titles every 2 minutes;
- scans the complete 30-page catalog every 15 minutes;
- fingerprints title metadata;
- detects new IDs, episode-count changes and meaningful metadata changes;
- places only post-baseline deltas into `sync_queue`.

The historical catalog was explicitly established as a future-only baseline. The first fingerprint pass over all 30 pages produced zero false new-release jobs.

### Episode / public media
Direct requests to `dramabox.dramafren.org` still receive a Cloudflare HTTP 403 from both Supabase and Vercel. BingeBox does not bypass that challenge.

The episode adapter instead uses the official DramaBox website:

- `GET https://www.dramabox.com/en/drama/{bookId}`
- ordinary public HTTPS request;
- server-rendered `__NEXT_DATA__`;
- `props.pageProps.chapterList` supplies chapter IDs, indices, duration, unlock state and any publicly available MP4.

This route is reachable from Supabase and returns HTTP 200.

Only already-public/unlocked media is accepted. BingeBox does **not** call signed mobile-app unlock/batch-download APIs and does not attempt to unlock protected episodes.

## Verified production tests

### Container Tycoon: The Billion-Dollar Bid — 42000028125
Official DramaBox detail:
- 70 chapters detected;
- 13 publicly unlocked MP4s exposed.

BingeBox worker result:
- 70 episode rows;
- 13 active `dramabox_web` direct sources;
- 0 failed jobs;
- 0 pending media jobs after validation.

### The Heirless Alpha's Miracle Omega — 42000027224
Official DramaBox detail:
- 53 chapters detected;
- 11 publicly unlocked MP4s exposed.

BingeBox worker result:
- 53 episode rows;
- 11 active direct sources;
- 0 failed jobs.

### Direct media verification
A representative official DramaBox MP4 was requested with `Range: bytes=0-0` and returned:
- HTTP 206;
- `video/mp4`;
- byte-range support;
- CloudFront/S3 origin.

The BingeBox frontend already loads any non-`legacy_r2` `episode_sources.source_url` directly in the browser. Therefore new `dramabox_web` sources do not stream video bytes through Supabase or Vercel.

Existing `legacy_r2` media remains untouched and preferred for episodes that already have `video_key`.

## Temporary source lifecycle
Official DramaBox MP4 URLs can be signed/temporary. The worker:
- parses URL expiry;
- stores `expires_at`;
- marks source stability `temporary`;
- validates every MP4 before storing it;
- records health and last verification time.

`bingebox-dramabox-source-refresh` runs every 30 minutes for published mapped titles and queues a high-priority episode refresh when a source:
- is within 3 hours of expiry;
- is already expired/failed/inactive; or
- is missing for a published episode without R2.

The existing source-expiry job continues running every 10 minutes.

## Queue and future-only baseline
Tables:
- `source_sync_state`
- `sync_queue`
- `sync_events`
- `content_source_map`

The initial browse catalog is historical baseline/backfill, not normal new-release traffic.

Priority policy:
- expiry/source recovery: priority 5-6;
- new episode-count changes / new releases: priority 10-50;
- explicit historical title backfill: priority 200;
- historical episode backfill: priority 210;
- historical media validation: priority 220.

Fresh releases therefore always outrank historical backfill.

## Explicit historical backfill
The owner explicitly requested the full historical catalog to be synchronized.

All current browse titles were bulk-created/mapped as unpublished BingeBox drafts without spending Edge Function invocations on trivial one-by-one title inserts.

The remaining backfill path is:
1. one `resolve_episodes` job per title;
2. bulk episode upsert;
3. one batched `resolve_media` job per title;
4. each public MP4 range-validated independently;
5. direct sources persisted.

The worker cron is queue-gated and currently invokes up to 20 worker calls per minute while work exists. Each Edge invocation processes up to five queue jobs. When the queue is empty, the gate makes no worker calls.

At the latest production health check during backfill:
- catalog ready: 3,029;
- browse titles mapped: 3,003;
- BingeBox dramas: 3,030;
- BingeBox episode rows: 15,899 and increasing;
- queue failures: 0;
- published catalog remains 3 dramas / 116 episodes until rights/publication requirements are satisfied.

These numbers are an in-progress snapshot; `get_bingebox_sync_health()` is the authoritative live state.

## Publishing / rights
Automatically discovered historical/new titles are created as drafts. New `drama_rights` rows remain unverified unless an existing mapped BingeBox title already has verified rights.

The worker does not auto-publish a newly discovered title merely because a public stream exists.

For an already-published, rights-verified mapped title, a newly resolved playable episode can be published without replacing any existing R2 source.

## R2
The clean public catalog still contains 116 R2-backed published episodes. Signed R2 delivery was previously verified end to end with HTTP 206 range playback.

R2 is no longer a prerequisite for normal upstream playback. It remains appropriate for media BingeBox intentionally owns/mirrors.

## Direct DramaFren HTTP 403
`https://dramabox.dramafren.org/` remains an hourly low-cost recovery probe. Its 403 no longer blocks:
- catalog discovery;
- metadata sync;
- episode discovery;
- public-media resolution.

The working source chain is currently:
```
Webfic public browse → catalog
official dramabox.com SSR → chapterList + public MP4
browser → direct dramaboxdb.com MP4
```

## Operational retention
Daily cleanup preserves production/deduplication state while bounding operational history:
- completed sync jobs: 30 days;
- failed/blocked jobs: 90 days;
- sync events: 14 days.

Pending/processing work, source mappings, fingerprints, catalog state and deduplication state are not deleted.

## Health
Service-role RPC:
`public.get_bingebox_sync_health()`

It reports:
- source watermark / last successful scanner run;
- catalog/mapping counts;
- queue pending/processing/retry/failed/completed counts;
- library episode/source counts;
- latest structured sync events.

## Current limitations
1. Only media already publicly exposed by the official DramaBox web page is imported. Locked/protected chapters are intentionally not unlocked through private/signed mobile APIs.
2. Newly discovered dramas remain unpublished until BingeBox's rights/publication requirements are satisfied.
3. The historical episode/media backfill is still being drained by Supabase workers; use the health RPC for current completion state.

Do not claim the entire 3,000-title historical catalog is playable until the backfill has completed and the resulting source inventory is verified.

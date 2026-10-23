-- Emergency maintenance recovery, 2026-10-24.
-- Source refresh is bounded to 25 titles per run and suppresses duplicate
-- pending/in-flight jobs or recent (<24h) retries for the same title.
-- This prevents the previous 1.8M-job queue explosion and read-only database.
-- Only fetch/verify already publicly accessible provider media; no unlock bypass.

CREATE OR REPLACE FUNCTION public.enqueue_expiring_dramabox_refresh()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer := 0;
BEGIN
  WITH due AS (
    SELECT m.source_content_id
    FROM public.content_source_map m
    JOIN public.dramas d ON d.id = m.drama_id AND d.published
    WHERE m.source_key = 'dramafren_webfic'
      AND (
        NOT EXISTS (SELECT 1 FROM public.episodes e WHERE e.drama_id=d.id AND e.episode_number=1)
        OR EXISTS (
          SELECT 1 FROM public.episodes e
          WHERE e.drama_id=d.id AND e.episode_number=1
            AND nullif(e.video_key,'') IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.episode_sources s
              WHERE s.episode_id=e.id AND s.active
                AND s.health_status='healthy'
                AND nullif(s.source_url,'') IS NOT NULL
                AND s.last_verified_at >= now()-interval '24 hours'
                AND (s.expires_at IS NULL OR s.expires_at>now()+interval '2 minutes')
            )
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.sync_queue q
        WHERE q.source_key='dramafren_webfic'
          AND q.source_content_id=m.source_content_id
          AND q.job_type IN ('resolve_episodes','resolve_media')
          AND (
            q.status IN ('pending','processing','retry_wait')
            OR q.created_at >= now()-interval '24 hours'
          )
      )
    ORDER BY m.source_content_id
    LIMIT 25
  ), queued AS (
    INSERT INTO public.sync_queue (source_key,source_content_id,job_type,idempotency_key,payload,status,priority)
    SELECT 'dramafren_webfic',due.source_content_id,'resolve_episodes',
      'bingebox:dramafren_webfic:'||due.source_content_id||':resolve_episodes:repair:'||to_char(now(),'YYYYMMDDHH24'),
      jsonb_build_object('refresh',true,'repair_reason','missing_or_stale_first_episode'),
      'pending',5
    FROM due
    ON CONFLICT(idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM queued;
  RETURN v_count;
END
$function$


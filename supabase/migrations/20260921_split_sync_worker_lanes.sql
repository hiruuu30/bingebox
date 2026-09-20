
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'bingebox-dramafren-sync-workers',
  'bingebox-dramafren-sync-episodes',
  'bingebox-dramafren-sync-media'
);

select cron.schedule(
  'bingebox-dramafren-sync-episodes',
  '* * * * *',
  $cmd$
  do $gate$
  begin
    if exists (
      select 1 from public.sync_queue
      where job_type in ('title_new','title_changed','episode_count_changed','resolve_episodes')
        and (
          status in ('pending','processing')
          or (status='retry_wait' and coalesce(next_retry_at,'-infinity'::timestamptz)<=now())
        )
    ) then
      perform net.http_post(
        url := 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/dramafren-sync-worker?lane=episodes',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      )
      from generate_series(1,20);
    end if;
  end
  $gate$;
  $cmd$
);

select cron.schedule(
  'bingebox-dramafren-sync-media',
  '* * * * *',
  $cmd$
  do $gate$
  begin
    if exists (
      select 1 from public.sync_queue
      where job_type='resolve_media'
        and (
          status in ('pending','processing')
          or (status='retry_wait' and coalesce(next_retry_at,'-infinity'::timestamptz)<=now())
        )
    ) then
      perform net.http_post(
        url := 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/dramafren-sync-worker?lane=media',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      )
      from generate_series(1,10);
    end if;
  end
  $gate$;
  $cmd$
);

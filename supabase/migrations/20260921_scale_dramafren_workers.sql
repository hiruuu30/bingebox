
do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='bingebox-dramafren-sync-workers';
  if j is not null then
    perform cron.alter_job(
      j,
      active := true,
      command := $cmd$
      do $gate$
      begin
        if exists (
          select 1 from public.sync_queue
          where status in ('pending','processing')
             or (status='retry_wait' and coalesce(next_retry_at,'-infinity'::timestamptz)<=now())
        ) then
          perform net.http_post(
            url := 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/dramafren-sync-worker',
            headers := '{"Content-Type":"application/json"}'::jsonb,
            body := '{}'::jsonb,
            timeout_milliseconds := 60000
          )
          from generate_series(1,12);
        end if;
      end
      $gate$;
      $cmd$
    );
  end if;
end $$;

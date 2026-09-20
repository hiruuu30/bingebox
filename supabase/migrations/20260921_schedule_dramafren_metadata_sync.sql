do $$
begin
  perform cron.schedule(
    'bingebox-dramafren-metadata-sync',
    '* * * * *',
    $cmd$
    do $gate$
    begin
      if exists (
        select 1 from public.dramafren_catalog_queue
        where next_attempt_at <= now()
          and status in ('pending','failed')
      ) then
        perform net.http_post(
          url := 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/dramafren-metadata-sync',
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := '{}'::jsonb,
          timeout_milliseconds := 20000
        );
      end if;
    end
    $gate$;
    $cmd$
  );
end
$$;

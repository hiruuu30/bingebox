-- Keep BingeBox sync independent of Vercel deployment state.
-- Supabase Cron wakes the existing resumable cloud importer every 10 minutes.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'bingebox-cloud-importer-heartbeat',
  '*/10 * * * *',
  $job$
    select net.http_post(
      url := 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/cloud-importer?action=work',
      headers := '{"Content-Type":"application/json","apikey":"sb_publishable_PeopMn9aiDdzxqLvSkkR6w_PUw9BIJH"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $job$
);

select cron.unschedule(jobid)
from cron.job
where jobname='bingebox-dramafren-v2-sync';

select cron.schedule(
  'bingebox-dramafren-v2-sync',
  '7 * * * *',
  $cmd$
  select net.http_post(
    url := 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/dramafren-v2-sync',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $cmd$
);

select cron.schedule(
  'bingebox-dramafren-home-seed',
  '17 */6 * * *',
  $cmd$
  select net.http_post(
    url := 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/dramafren-metadata-sync?action=seed_home',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $cmd$
);

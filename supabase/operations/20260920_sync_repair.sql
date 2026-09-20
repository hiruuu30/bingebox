BEGIN;
-- Duplicate heartbeat; the original one-minute queue workers remain.
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname='bingebox-cloud-importer-heartbeat';
-- Preserve the existing endpoint and credentials inside cron; only add queue gating.
DO $block$
DECLARE j record; predicate text;
BEGIN
  FOR j IN SELECT jobid,jobname,command FROM cron.job WHERE jobname IN ('bingebox-cloud-importer','bingebox-cloud-seed-importer') LOOP
    IF position('bingebox_queue_gate_v1' in j.command)=0 THEN
      predicate := CASE WHEN j.jobname='bingebox-cloud-importer'
        THEN 'SELECT 1 FROM public.cloud_import_jobs WHERE status IN (''pending'',''running'') AND (mode IS NULL OR mode=''server_fetch'')'
        ELSE 'SELECT 1 FROM public.cloud_import_jobs WHERE mode=''browser_seed'' AND status=''seeded''' END;
      PERFORM cron.alter_job(j.jobid, command := format('DO $queue$ BEGIN /* bingebox_queue_gate_v1 */ IF EXISTS (%s) THEN EXECUTE %L; END IF; END $queue$;',predicate,j.command));
    END IF;
  END LOOP;
END $block$;
UPDATE public.episode_sources SET active=false,health_status='expired',updated_at=now()
WHERE provider='external' AND active AND expires_at IS NOT NULL AND expires_at<=now();
SELECT cron.schedule('bingebox-expire-sources','*/10 * * * *',
  $task$UPDATE public.episode_sources SET active=false,health_status='expired',updated_at=now()
  WHERE provider='external' AND active AND expires_at IS NOT NULL AND expires_at<=now();$task$);
COMMIT;
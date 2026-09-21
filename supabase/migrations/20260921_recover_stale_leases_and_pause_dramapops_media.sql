-- Recover abandoned leases automatically and pause the unreliable DramaPops mirror media lane.

do $outer$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname='bingebox-stale-lease-recovery' limit 1;
  if jid is null then
    perform cron.schedule(
      'bingebox-stale-lease-recovery',
      '*/5 * * * *',
      $cmd$
      update public.sync_queue
      set status='pending',
          claimed_by=null,
          heartbeat_at=null,
          lease_expires_at=null,
          next_retry_at=null,
          updated_at=now()
      where status='processing'
        and (lease_expires_at is null or lease_expires_at < now());
      $cmd$
    );
  else
    perform cron.alter_job(
      jid,
      '*/5 * * * *',
      $cmd$
      update public.sync_queue
      set status='pending',
          claimed_by=null,
          heartbeat_at=null,
          lease_expires_at=null,
          next_retry_at=null,
          updated_at=now()
      where status='processing'
        and (lease_expires_at is null or lease_expires_at < now());
      $cmd$,
      null,
      null,
      true
    );
  end if;

  select jobid into jid from cron.job where jobname='bingebox-dramafren-provider-media' limit 1;
  if jid is not null then
    perform cron.alter_job(
      jid,
      '*/5 * * * *',
      $cmd$
      do $gate$
      begin
        if exists (
          select 1 from public.sync_queue
          where source_key='dramafren_flextv'
            and job_type='provider_resolve_media'
            and status in ('pending','retry_wait')
            and coalesce(next_retry_at,created_at)<=now()
        ) then
          perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_flextv')
          from generate_series(1,2);
        end if;
      end
      $gate$;
      $cmd$,
      null,
      null,
      true
    );
  end if;
end
$outer$;

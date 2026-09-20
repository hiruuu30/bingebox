
do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='bingebox-dramafren-sync-workers';
  if j is not null then perform cron.alter_job(j,active:=true); end if;
end $$;

create or replace function public.cleanup_bingebox_sync_operational()
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  q_completed integer:=0;
  q_failed integer:=0;
  ev integer:=0;
begin
  delete from public.sync_queue
  where status='completed'
    and completed_at < now()-interval '30 days';
  get diagnostics q_completed=row_count;

  delete from public.sync_queue
  where status in ('failed','blocked')
    and updated_at < now()-interval '90 days';
  get diagnostics q_failed=row_count;

  delete from public.sync_events
  where occurred_at < now()-interval '14 days';
  get diagnostics ev=row_count;

  return jsonb_build_object(
    'completed_jobs_deleted',q_completed,
    'failed_jobs_deleted',q_failed,
    'events_deleted',ev
  );
end;
$$;

revoke all on function public.cleanup_bingebox_sync_operational() from public,anon,authenticated;
grant execute on function public.cleanup_bingebox_sync_operational() to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname='bingebox-sync-retention-cleanup';

select cron.schedule(
  'bingebox-sync-retention-cleanup',
  '23 4 * * *',
  'select public.cleanup_bingebox_sync_operational();'
);

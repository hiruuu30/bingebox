create or replace function public.run_bingebox_sync_scheduler()
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  t public.bingebox_sync_targets%rowtype;
  j public.cloud_import_jobs%rowtype;
  new_job_id uuid;
  enqueued integer := 0;
  reconciled integer := 0;
  failures integer;
  delay_minutes integer;
  is_dramafren_403 boolean;
begin
  for t in
    select * from public.bingebox_sync_targets
    order by next_run_at asc, created_at asc
  loop
    if t.last_job_id is not null then
      select * into j from public.cloud_import_jobs where id = t.last_job_id;
      if found
         and j.status in ('completed','completed_with_errors','failed','cancelled')
         and t.last_status is distinct from j.status then

        if j.status = 'completed' then
          update public.bingebox_sync_targets
          set consecutive_failures = 0,
              last_status = j.status,
              last_error = null,
              last_success_at = coalesce(j.finished_at, now()),
              next_run_at = now() + make_interval(mins => interval_minutes),
              updated_at = now()
          where id = t.id;
        else
          failures := t.consecutive_failures + 1;
          is_dramafren_403 := coalesce(j.last_error,'') ilike 'DramaFren returned HTTP 403%';
          delay_minutes := case
            when is_dramafren_403 then greatest(60, t.interval_minutes)
            else least(1440, t.interval_minutes * (2 ^ least(failures,3))::integer)
          end;

          update public.bingebox_sync_targets
          set consecutive_failures = failures,
              last_status = j.status,
              last_error = j.last_error,
              next_run_at = now() + make_interval(mins => delay_minutes),
              updated_at = now()
          where id = t.id;
        end if;
        reconciled := reconciled + 1;

        select * into t from public.bingebox_sync_targets where id = t.id;
      end if;
    end if;

    if t.enabled
       and t.next_run_at <= now()
       and not exists (
         select 1
         from public.cloud_import_jobs q
         where q.source_url = t.source_url
           and (q.mode is null or q.mode='server_fetch')
           and q.status in ('pending','running')
       ) then
      insert into public.cloud_import_jobs (
        source_url,status,auto_publish,source_urls,strict_mode,
        rights_attested,mode,seed_closed
      )
      values (
        t.source_url,'pending',false,'[]'::jsonb,true,
        false,'server_fetch',false
      )
      returning id into new_job_id;

      update public.bingebox_sync_targets
      set last_job_id = new_job_id,
          last_status = 'pending',
          last_error = null,
          last_attempt_at = now(),
          next_run_at = now() + make_interval(mins => interval_minutes),
          updated_at = now()
      where id = t.id;
      enqueued := enqueued + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'enqueued', enqueued,
    'reconciled', reconciled
  );
end;
$function$;

update public.bingebox_sync_targets
set enabled=true,
    interval_minutes=60,
    next_run_at=now(),
    updated_at=now()
where source_url='https://dramabox.dramafren.org/';

update public.dramafren_catalog_queue
set next_attempt_at=least(next_attempt_at, now() + interval '1 hour')
where status='ready';

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='bingebox-dramafren-home-seed';
  if v_jobid is not null then
    perform cron.alter_job(v_jobid, schedule := '17 * * * *');
  end if;
end $$;

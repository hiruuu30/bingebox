-- BingeBox automated sync orchestration and crash-safe job leasing.
-- 2026-09-21

alter table public.cloud_import_jobs
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz;

alter table public.cloud_import_jobs
  drop constraint if exists cloud_import_jobs_attempt_count_check;
alter table public.cloud_import_jobs
  add constraint cloud_import_jobs_attempt_count_check check (attempt_count >= 0);

create index if not exists cloud_import_jobs_claim_idx
  on public.cloud_import_jobs (status, mode, created_at)
  where status in ('pending','running');

create table if not exists public.bingebox_sync_targets (
  id uuid primary key default gen_random_uuid(),
  source_url text not null unique check (source_url ~ '^https://'),
  enabled boolean not null default true,
  interval_minutes integer not null default 360 check (interval_minutes between 15 and 10080),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  next_run_at timestamptz not null default now(),
  last_job_id uuid references public.cloud_import_jobs(id) on delete set null,
  last_status text,
  last_error text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bingebox_sync_targets enable row level security;
revoke all on table public.bingebox_sync_targets from anon, authenticated;
grant select, insert, update, delete on table public.bingebox_sync_targets to service_role;

create or replace function public.claim_bingebox_cloud_import_job(
  p_worker uuid,
  p_lease_seconds integer default 90
)
returns setof public.cloud_import_jobs
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_worker is null then
    raise exception 'worker token is required';
  end if;

  return query
  with candidate as (
    select j.id
    from public.cloud_import_jobs j
    where (j.mode is null or j.mode = 'server_fetch')
      and coalesce(j.next_attempt_at, '-infinity'::timestamptz) <= now()
      and (
        j.status = 'pending'
        or (
          j.status = 'running'
          and coalesce(j.lease_expires_at, j.heartbeat_at + interval '2 minutes', '-infinity'::timestamptz) <= now()
        )
      )
    order by j.created_at asc
    for update skip locked
    limit 1
  )
  update public.cloud_import_jobs j
  set status = 'running',
      started_at = coalesce(j.started_at, now()),
      heartbeat_at = now(),
      lease_token = p_worker,
      lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds,90),300))),
      attempt_count = j.attempt_count + 1
  from candidate c
  where j.id = c.id
  returning j.*;
end;
$$;

revoke all on function public.claim_bingebox_cloud_import_job(uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_bingebox_cloud_import_job(uuid,integer) to service_role;

create or replace function public.run_bingebox_sync_scheduler()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  t public.bingebox_sync_targets%rowtype;
  j public.cloud_import_jobs%rowtype;
  new_job_id uuid;
  enqueued integer := 0;
  reconciled integer := 0;
  auto_paused integer := 0;
  failures integer;
  delay_minutes integer;
  should_pause boolean;
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
          should_pause := failures >= 3
            and coalesce(j.last_error,'') ilike 'DramaFren returned HTTP 403%';
          delay_minutes := least(1440, t.interval_minutes * (2 ^ least(failures,3))::integer);

          update public.bingebox_sync_targets
          set consecutive_failures = failures,
              enabled = case when should_pause then false else enabled end,
              last_status = j.status,
              last_error = j.last_error,
              next_run_at = now() + make_interval(mins => delay_minutes),
              updated_at = now()
          where id = t.id;

          if should_pause then auto_paused := auto_paused + 1; end if;
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
    'reconciled', reconciled,
    'auto_paused', auto_paused
  );
end;
$$;

revoke all on function public.run_bingebox_sync_scheduler() from public, anon, authenticated;
grant execute on function public.run_bingebox_sync_scheduler() to service_role;

-- One final bounded attempt is allowed for the currently configured root.
-- Two prior 403 failures are recorded so one more 403 automatically pauses it.
insert into public.bingebox_sync_targets (
  source_url, enabled, interval_minutes, consecutive_failures, next_run_at,
  last_status, last_error
)
values (
  'https://dramabox.dramafren.org/',
  true,
  360,
  2,
  now(),
  'failed',
  'Historical provider access failures; one bounded verification attempt remains.'
)
on conflict (source_url) do update
set interval_minutes = excluded.interval_minutes,
    updated_at = now();

select cron.schedule(
  'bingebox-sync-scheduler',
  '*/15 * * * *',
  'select public.run_bingebox_sync_scheduler();'
);

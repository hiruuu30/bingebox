
create or replace function public.claim_dramafren_catalog_item(
  p_worker text,
  p_lease_seconds integer default 90
)
returns setof public.dramafren_catalog_queue
language plpgsql
security invoker
set search_path=public
as $$
begin
  if coalesce(trim(p_worker),'')='' then
    raise exception 'worker is required';
  end if;

  return query
  with candidate as (
    select q.book_id
    from public.dramafren_catalog_queue q
    where q.next_attempt_at <= now()
      and (
        q.status in ('pending','failed')
        or (
          q.status='processing'
          and q.updated_at <= now() - make_interval(secs => greatest(30,least(coalesce(p_lease_seconds,90),300)))
        )
      )
    order by
      case q.status when 'pending' then 0 when 'failed' then 1 else 2 end,
      q.next_attempt_at asc,
      q.first_seen_at asc
    for update skip locked
    limit 1
  )
  update public.dramafren_catalog_queue q
  set status='processing',
      attempt_count=q.attempt_count+1,
      updated_at=now(),
      last_error=null
  from candidate c
  where q.book_id=c.book_id
  returning q.*;
end;
$$;

revoke all on function public.claim_dramafren_catalog_item(text,integer) from public,anon,authenticated;
grant execute on function public.claim_dramafren_catalog_item(text,integer) to service_role;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='bingebox-dramafren-home-seed';
  if v_jobid is not null then
    perform cron.alter_job(v_jobid, active := false);
  end if;

  select jobid into v_jobid from cron.job where jobname='bingebox-dramafren-metadata-sync';
  if v_jobid is not null then
    perform cron.alter_job(
      v_jobid,
      command := $cmd$
      do $gate$
      begin
        if exists (
          select 1 from public.dramafren_catalog_queue
          where next_attempt_at <= now()
            and status in ('pending','failed','processing')
        ) then
          perform net.http_post(
            url := 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/dramafren-metadata-sync',
            headers := '{"Content-Type":"application/json"}'::jsonb,
            body := '{}'::jsonb,
            timeout_milliseconds := 30000
          );
        end if;
      end
      $gate$;
      $cmd$
    );
  end if;
end $$;

select cron.unschedule(jobid)
from cron.job
where jobname in ('bingebox-dramafren-catalog-full','bingebox-dramafren-catalog-latest');

select cron.schedule(
  'bingebox-dramafren-catalog-full',
  '*/15 * * * *',
  $cmd$
  select net.http_post(
    url := 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/dramafren-catalog-sync?group=' || g::text,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  from generate_series(0,5) g;
  $cmd$
);

select cron.schedule(
  'bingebox-dramafren-catalog-latest',
  '*/2 * * * *',
  $cmd$
  select net.http_post(
    url := 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/dramafren-catalog-sync?group=0',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cmd$
);

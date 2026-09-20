
-- Explicit historical backfill requested by the owner.
-- New-release scanner jobs retain much higher priority (10-50).

insert into public.sync_queue(
  source_key,source_content_id,job_type,idempotency_key,payload,status,priority
)
select
  'dramafren_webfic',
  q.book_id,
  'title_new',
  'bingebox:dramafren_webfic:'||q.book_id||':title_new:backfill-v1',
  jsonb_build_object('backfill',true,'catalog_fingerprint',q.metadata_fingerprint),
  'pending',
  200
from public.dramafren_catalog_queue q
where q.discovered_from='webfic_browse'
on conflict (idempotency_key) do nothing;

insert into public.sync_queue(
  source_key,source_content_id,job_type,idempotency_key,payload,status,priority
)
select
  'dramafren_webfic',
  q.book_id,
  'resolve_episodes',
  'bingebox:dramafren_webfic:'||q.book_id||':resolve_episodes:backfill-v1',
  jsonb_build_object('backfill',true,'chapter_count',q.chapter_count,'canonical_url',q.canonical_url),
  'pending',
  210
from public.dramafren_catalog_queue q
where q.discovered_from='webfic_browse'
on conflict (idempotency_key) do nothing;

select cron.unschedule(jobid)
from cron.job
where jobname='bingebox-dramafren-sync-workers';

select cron.schedule(
  'bingebox-dramafren-sync-workers',
  '* * * * *',
  $cmd$
  do $gate$
  begin
    if exists (
      select 1 from public.sync_queue
      where status in ('pending','processing')
         or (status='retry_wait' and coalesce(next_retry_at,'-infinity'::timestamptz)<=now())
    ) then
      perform net.http_post(
        url := 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/dramafren-sync-worker',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      )
      from generate_series(1,5);
    end if;
  end
  $gate$;
  $cmd$
);

create or replace function public.enqueue_expiring_dramabox_refresh()
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare n integer:=0;
begin
  with due as (
    select m.source_content_id,min(s.expires_at) as exp
    from public.content_source_map m
    join public.dramas d on d.id=m.drama_id and d.published
    join public.episodes e on e.drama_id=d.id and e.published
    join public.episode_sources s on s.episode_id=e.id
      and s.provider='dramabox_web' and s.active
      and s.expires_at is not null
      and s.expires_at <= now()+interval '3 hours'
    where m.source_key='dramafren_webfic'
    group by m.source_content_id
  ),
  ins as (
    insert into public.sync_queue(
      source_key,source_content_id,job_type,idempotency_key,payload,status,priority
    )
    select
      'dramafren_webfic',
      source_content_id,
      'resolve_episodes',
      'bingebox:dramafren_webfic:'||source_content_id||':resolve_episodes:refresh:'||
        floor(extract(epoch from exp)/3600)::bigint::text,
      jsonb_build_object('refresh',true,'expires_at',exp),
      'pending',
      5
    from due
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*) into n from ins;
  return n;
end;
$$;

revoke all on function public.enqueue_expiring_dramabox_refresh() from public,anon,authenticated;
grant execute on function public.enqueue_expiring_dramabox_refresh() to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname='bingebox-dramabox-source-refresh';

select cron.schedule(
  'bingebox-dramabox-source-refresh',
  '*/30 * * * *',
  'select public.enqueue_expiring_dramabox_refresh();'
);

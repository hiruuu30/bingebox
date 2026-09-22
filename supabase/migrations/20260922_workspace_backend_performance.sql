-- Keep BingeBox Workspace responsive as the catalog and sync queues grow.

alter policy "authenticated can read dramas"
on public.dramas
using (
  (select private.is_admin())
  or (published = true and (publish_at is null or publish_at <= now()))
);

alter policy "authenticated can read episodes"
on public.episodes
using (
  (select private.is_admin())
  or (
    published = true
    and (publish_at is null or publish_at <= now())
    and exists (
      select 1
      from public.dramas d
      where d.id = episodes.drama_id
        and d.published = true
        and (d.publish_at is null or d.publish_at <= now())
    )
  )
);

create index if not exists episodes_workspace_published_idx
on public.episodes (id, drama_id, episode_number)
include (title)
where published=true;

create index if not exists sync_queue_dashboard_idx
on public.sync_queue (job_type, status, source_key);

create index if not exists sync_queue_recent_error_idx
on public.sync_queue (updated_at desc)
include (source_key,job_type,status,source_content_id,last_error,attempt_count)
where status in ('retry_wait','failed');

create index if not exists episode_sources_workspace_provider_idx
on public.episode_sources (provider, active, health_status, expires_at);

create index if not exists episode_sources_workspace_episode_idx
on public.episode_sources (episode_id)
include (active, expires_at, health_status, provider);

create table if not exists private.workspace_dashboard_cache (
  cache_key text primary key,
  payload jsonb not null,
  refreshed_at timestamptz not null default now()
);

revoke all on table private.workspace_dashboard_cache from public, anon, authenticated;

create or replace function public.get_bingebox_workspace_library()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_catalog
set work_mem = '32MB'
as $$
declare
  result jsonb;
begin
  if not private.is_admin() then
    raise exception 'Admin access required';
  end if;

  with episode_counts as (
    select e.drama_id, count(*)::bigint as episode_count
    from public.episodes e
    group by e.drama_id
  ),
  rows as (
    select
      d.id,d.slug,d.title,d.genre,d.mood,d.description,d.poster_url,d.featured,d.published,
      d.sort_order,d.created_at,d.updated_at,d.is_complete,d.publish_at,d.is_r18,
      d.completion_push_sent_at,
      coalesce(ec.episode_count,0)::bigint as episode_count
    from public.dramas d
    left join episode_counts ec on ec.drama_id=d.id
    order by d.sort_order asc,d.created_at desc
  )
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb),
    'total',count(*)
  )
  into result
  from rows;

  return result;
end;
$$;

revoke all on function public.get_bingebox_workspace_library() from public,anon;
grant execute on function public.get_bingebox_workspace_library() to authenticated,service_role;

create or replace function private.compute_bingebox_workspace_source_health()
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_catalog
set work_mem = '32MB'
as $$
with published as (
  select e.id,e.drama_id,e.episode_number,e.title
  from public.episodes e
  where e.published
),
source_rollup as (
  select
    p.id episode_id,
    count(s.id) as source_count,
    count(s.id) filter(where s.active) as active_count,
    count(s.id) filter(where s.active and (s.expires_at is null or s.expires_at>now()+interval '30 seconds')) as usable_count,
    count(s.id) filter(where s.active and s.expires_at is not null and s.expires_at<=now()+interval '30 seconds') as expired_active_count,
    count(s.id) filter(where s.active and s.expires_at is not null and s.expires_at>now()+interval '30 seconds' and s.expires_at<=now()+interval '48 hours') as expiring_48h_count
  from published p
  left join public.episode_sources s on s.episode_id=p.id
  group by p.id
),
classified as (
  select p.*,
    coalesce(r.source_count,0) source_count,
    coalesce(r.active_count,0) active_count,
    coalesce(r.usable_count,0) usable_count,
    coalesce(r.expired_active_count,0) expired_active_count,
    coalesce(r.expiring_48h_count,0) expiring_48h_count,
    case
      when coalesce(r.usable_count,0)>0 then 'covered'
      when coalesce(r.active_count,0)>0 and coalesce(r.expired_active_count,0)>0 then 'expired'
      when coalesce(r.source_count,0)>0 then 'disabled'
      else 'missing'
    end state
  from published p
  left join source_rollup r on r.episode_id=p.id
),
stats as (
  select
    count(*)::bigint published,
    count(*) filter(where state='covered')::bigint covered,
    count(*) filter(where state='missing')::bigint missing,
    count(*) filter(where state='disabled')::bigint disabled_only,
    count(*) filter(where state='expired')::bigint expired_only,
    count(*) filter(where usable_count>1)::bigint multi_server,
    coalesce(sum(expiring_48h_count),0)::bigint expiring_48h
  from classified
),
source_stats as (
  select
    count(*) filter(where active)::bigint active_sources,
    count(*) filter(where not active)::bigint inactive_sources,
    count(*) filter(where active and health_status='healthy')::bigint healthy_sources,
    count(*) filter(where active and expires_at is not null and expires_at<=now()+interval '30 seconds')::bigint expired_active_sources,
    count(*) filter(where active and expires_at is not null and expires_at>now()+interval '30 seconds' and expires_at<=now()+interval '48 hours')::bigint expiring_sources
  from public.episode_sources
),
issues as (
  select c.id episode_id,c.drama_id,c.episode_number,c.title,c.state,d.title drama_title,
         c.source_count,c.active_count,c.usable_count
  from classified c
  join public.dramas d on d.id=c.drama_id
  where c.state<>'covered'
  order by case c.state when 'expired' then 1 when 'missing' then 2 else 3 end,d.title,c.episode_number
  limit 12
)
select jsonb_build_object(
  'at',now(),
  'published_episodes',s.published,
  'covered',s.covered,
  'coverage_pct',case when s.published=0 then 100 else round(100.0*s.covered/s.published,1) end,
  'missing',s.missing,
  'disabled_only',s.disabled_only,
  'expired_only',s.expired_only,
  'needs_source',s.missing+s.disabled_only+s.expired_only,
  'multi_server',s.multi_server,
  'expiring_48h',s.expiring_48h,
  'sources',to_jsonb(ss),
  'playback_errors_7d',(select count(*)::bigint from public.analytics_events where created_at>=now()-interval '7 days' and event_type='playback_error'),
  'issues',coalesce((select jsonb_agg(to_jsonb(i)) from issues i),'[]'::jsonb)
)
from stats s cross join source_stats ss;
$$;

create or replace function private.compute_bingebox_workspace_sync_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_catalog
set work_mem = '32MB'
as $$
with
obs as (
  select source_key,count(*)::bigint observations,
         count(*) filter(where canonical_drama_id is not null)::bigint mapped
  from public.dramafren_source_observations
  group by source_key
),
q as (
  select source_key,job_type,status,count(*)::bigint n
  from public.sync_queue
  group by source_key,job_type,status
),
qsource as (
  select source_key,
    coalesce(sum(n) filter(where status='pending'),0)::bigint pending,
    coalesce(sum(n) filter(where status='processing'),0)::bigint processing,
    coalesce(sum(n) filter(where status='retry_wait'),0)::bigint retry_wait,
    coalesce(sum(n) filter(where status='failed'),0)::bigint failed,
    coalesce(sum(n) filter(where status='completed'),0)::bigint completed
  from q group by source_key
),
lanes as (
  select job_type,
    coalesce(sum(n) filter(where status='pending'),0)::bigint pending,
    coalesce(sum(n) filter(where status='processing'),0)::bigint processing,
    coalesce(sum(n) filter(where status='retry_wait'),0)::bigint retry_wait,
    coalesce(sum(n) filter(where status='failed'),0)::bigint failed,
    coalesce(sum(n) filter(where status='completed'),0)::bigint completed,
    coalesce(sum(n),0)::bigint total
  from q group by job_type
),
queue_totals as (
  select
    count(*) filter(where status='pending')::bigint pending,
    count(*) filter(where status='processing')::bigint processing,
    count(*) filter(where status='retry_wait')::bigint retry_wait,
    count(*) filter(where status='failed')::bigint failed,
    count(*) filter(where status='completed')::bigint completed,
    count(*)::bigint total
  from public.sync_queue
),
src as (
  select provider,
    count(*) filter(where active)::bigint active,
    count(*) filter(where not active)::bigint inactive,
    count(*) filter(where active and health_status='healthy')::bigint healthy,
    count(*) filter(where active and expires_at is not null and expires_at<=now()+interval '48 hours')::bigint expiring_48h
  from public.episode_sources
  group by provider
),
library_counts as (
  select
    (select count(*)::bigint from public.dramas) dramas,
    (select count(*)::bigint from public.dramas where published) published_dramas,
    (select count(*)::bigint from public.episodes) episodes,
    (select count(*)::bigint from public.episodes where published) published_episodes,
    (select count(*)::bigint from public.dramas where poster_url is null or btrim(poster_url)='' or poster_url ilike '%default-book-cover%' or poster_url ilike '%placeholder%' or poster_url ilike '%/assets/brand/mark.svg%') poster_issues,
    (select count(*)::bigint from public.episode_sources where active) active_sources
),
provider_rows as (
  select r.source_key,r.provider,r.base_url,r.enabled,r.mode,
    s.last_successful_scan_at,s.updated_at as state_updated_at,
    coalesce(s.catalog_count,0)::bigint catalog_count,
    coalesce(o.observations,0)::bigint observations,
    coalesce(o.mapped,0)::bigint mapped,
    coalesce(qs.pending,0)::bigint pending,
    coalesce(qs.processing,0)::bigint processing,
    coalesce(qs.retry_wait,0)::bigint retry_wait,
    coalesce(qs.failed,0)::bigint failed,
    coalesce(qs.completed,0)::bigint completed,
    s.metadata->>'last_http_status' as last_http_status,
    lower(coalesce(s.metadata->>'cloudflare_blocked','false'))='true' as cloudflare_blocked,
    coalesce(nullif(s.metadata->>'last_errors',''),nullif(s.metadata->>'last_error',''),nullif(s.metadata->>'error','')) as last_error
  from public.dramafren_source_registry r
  left join public.source_sync_state s using(source_key)
  left join obs o using(source_key)
  left join qsource qs using(source_key)
  where r.enabled
),
http_counts as (
  select count(*)::bigint total,
    count(*) filter(where status_code between 200 and 299)::bigint ok,
    count(*) filter(where timed_out)::bigint timeouts,
    count(*) filter(where status_code=429)::bigint rate_limited
  from net._http_response
  where created>now()-interval '10 minutes'
)
select jsonb_build_object(
  'at',now(),
  'http_backlog',(select count(*)::bigint from net.http_request_queue),
  'http_recent',(select to_jsonb(h) from http_counts h),
  'library',(select to_jsonb(l) from library_counts l),
  'queue',(select to_jsonb(qt) from queue_totals qt),
  'lanes',coalesce((select jsonb_agg(to_jsonb(x) order by x.job_type) from lanes x),'[]'::jsonb),
  'providers',coalesce((select jsonb_agg(to_jsonb(x) order by x.provider) from provider_rows x),'[]'::jsonb),
  'episode_source_providers',coalesce((select jsonb_agg(to_jsonb(x) order by x.active desc,x.provider) from src x),'[]'::jsonb),
  'recent_errors',coalesce((
    select jsonb_agg(to_jsonb(x) order by x.updated_at desc)
    from (
      select source_key,job_type,status,source_content_id,left(coalesce(last_error,''),240) last_error,attempt_count,updated_at
      from public.sync_queue
      where status in ('retry_wait','failed') and coalesce(last_error,'')<>''
      order by updated_at desc
      limit 12
    ) x
  ),'[]'::jsonb)
);
$$;

revoke all on function private.compute_bingebox_workspace_source_health() from public,anon,authenticated;
revoke all on function private.compute_bingebox_workspace_sync_dashboard() from public,anon,authenticated;

create or replace function private.refresh_bingebox_workspace_cache()
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_sync jsonb;
  v_source jsonb;
begin
  v_sync := private.compute_bingebox_workspace_sync_dashboard();
  v_source := private.compute_bingebox_workspace_source_health();
  insert into private.workspace_dashboard_cache(cache_key,payload,refreshed_at)
  values ('sync_dashboard',v_sync,now()),('source_health',v_source,now())
  on conflict(cache_key) do update
  set payload=excluded.payload,refreshed_at=excluded.refreshed_at;
end;
$$;

revoke all on function private.refresh_bingebox_workspace_cache() from public,anon,authenticated;

create or replace function public.get_bingebox_workspace_sync_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  select payload into result from private.workspace_dashboard_cache where cache_key='sync_dashboard';
  if result is null then result := private.compute_bingebox_workspace_sync_dashboard(); end if;
  return result;
end;
$$;

create or replace function public.get_bingebox_workspace_source_health()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  select payload into result from private.workspace_dashboard_cache where cache_key='source_health';
  if result is null then result := private.compute_bingebox_workspace_source_health(); end if;
  return result;
end;
$$;

revoke all on function public.get_bingebox_workspace_sync_dashboard() from public,anon;
grant execute on function public.get_bingebox_workspace_sync_dashboard() to authenticated,service_role;
revoke all on function public.get_bingebox_workspace_source_health() from public,anon;
grant execute on function public.get_bingebox_workspace_source_health() to authenticated,service_role;

do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='bingebox-workspace-cache-refresh' limit 1;
  if j is not null then perform cron.unschedule(j); end if;
end $$;

select cron.schedule(
  'bingebox-workspace-cache-refresh',
  '*/5 * * * *',
  'select private.refresh_bingebox_workspace_cache();'
);

-- Admin-only live sync telemetry for /workspace.
-- Exposes aggregate provider/queue/source health without exposing sync secrets.

create or replace function public.get_bingebox_workspace_sync_dashboard()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $$
declare
  result jsonb;
begin
  if not private.is_admin() then
    raise exception 'Admin access required';
  end if;

  with
  obs as (
    select source_key,
           count(*)::bigint observations,
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
    from q
    group by job_type
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
  provider_rows as (
    select
      r.source_key,r.provider,r.base_url,r.enabled,r.mode,
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
      case when lower(coalesce(s.metadata->>'cloudflare_blocked','false'))='true' then true else false end as cloudflare_blocked,
      coalesce(nullif(s.metadata->>'last_errors',''),nullif(s.metadata->>'last_error',''),nullif(s.metadata->>'error','')) as last_error
    from public.dramafren_source_registry r
    left join public.source_sync_state s using(source_key)
    left join obs o using(source_key)
    left join qsource qs using(source_key)
    where r.enabled
  )
  select jsonb_build_object(
    'at',now(),
    'http_backlog',(select count(*)::bigint from net.http_request_queue),
    'http_recent',jsonb_build_object(
      'total',(select count(*)::bigint from net._http_response where created>now()-interval '10 minutes'),
      'ok',(select count(*)::bigint from net._http_response where created>now()-interval '10 minutes' and status_code between 200 and 299),
      'timeouts',(select count(*)::bigint from net._http_response where created>now()-interval '10 minutes' and timed_out),
      'rate_limited',(select count(*)::bigint from net._http_response where created>now()-interval '10 minutes' and status_code=429)
    ),
    'library',jsonb_build_object(
      'dramas',(select count(*)::bigint from public.dramas),
      'published_dramas',(select count(*)::bigint from public.dramas where published),
      'episodes',(select count(*)::bigint from public.episodes),
      'published_episodes',(select count(*)::bigint from public.episodes where published),
      'poster_issues',(select count(*)::bigint from public.dramas where poster_url is null or btrim(poster_url)='' or poster_url ilike '%default-book-cover%' or poster_url ilike '%placeholder%' or poster_url ilike '%/assets/brand/mark.svg%'),
      'active_sources',(select count(*)::bigint from public.episode_sources where active)
    ),
    'queue',jsonb_build_object(
      'pending',(select count(*)::bigint from public.sync_queue where status='pending'),
      'processing',(select count(*)::bigint from public.sync_queue where status='processing'),
      'retry_wait',(select count(*)::bigint from public.sync_queue where status='retry_wait'),
      'failed',(select count(*)::bigint from public.sync_queue where status='failed'),
      'completed',(select count(*)::bigint from public.sync_queue where status='completed'),
      'total',(select count(*)::bigint from public.sync_queue)
    ),
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
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_bingebox_workspace_sync_dashboard() from public,anon;
grant execute on function public.get_bingebox_workspace_sync_dashboard() to authenticated,service_role;

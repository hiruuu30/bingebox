-- Admin-only aggregate source-health RPC for /workspace.
-- Replaces browser downloads of the full episodes + episode_sources tables.

create or replace function public.get_bingebox_workspace_source_health()
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

  with published as (
    select e.id,e.drama_id,e.episode_number,e.title
    from public.episodes e
    where e.published
  ),
  source_rollup as (
    select
      p.id episode_id,
      count(s.id) source_count,
      count(s.id) filter(where s.active) active_count,
      count(s.id) filter(
        where s.active and (s.expires_at is null or s.expires_at>now()+interval '30 seconds')
      ) usable_count,
      count(s.id) filter(
        where s.active and s.expires_at is not null and s.expires_at<=now()+interval '30 seconds'
      ) expired_active_count,
      count(s.id) filter(
        where s.active and s.expires_at is not null
          and s.expires_at>now()+interval '30 seconds'
          and s.expires_at<=now()+interval '48 hours'
      ) expiring_48h_count
    from published p
    left join public.episode_sources s on s.episode_id=p.id
    group by p.id
  ),
  classified as (
    select
      p.*,
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
    select
      c.id episode_id,c.drama_id,c.episode_number,c.title,c.state,
      d.title drama_title,c.source_count,c.active_count,c.usable_count
    from classified c
    join public.dramas d on d.id=c.drama_id
    where c.state<>'covered'
    order by case c.state when 'expired' then 1 when 'missing' then 2 else 3 end,
             d.title,c.episode_number
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
    'playback_errors_7d',(
      select count(*)::bigint
      from public.analytics_events
      where created_at>=now()-interval '7 days' and event_type='playback_error'
    ),
    'issues',coalesce((select jsonb_agg(to_jsonb(i)) from issues i),'[]'::jsonb)
  )
  into result
  from stats s cross join source_stats ss;

  return result;
end;
$$;

revoke all on function public.get_bingebox_workspace_source_health() from public,anon;
grant execute on function public.get_bingebox_workspace_source_health() to authenticated,service_role;

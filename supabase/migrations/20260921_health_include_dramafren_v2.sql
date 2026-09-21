create or replace function public.get_bingebox_sync_health()
returns jsonb
language sql
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'at',now(),
    'source_state',(
      select to_jsonb(s) from public.source_sync_state s
      where s.source_key='dramafren_webfic'
    ),
    'secondary_sources',(
      select coalesce(jsonb_agg(to_jsonb(s) order by s.source_key),'[]'::jsonb)
      from public.source_sync_state s
      where s.source_key<>'dramafren_webfic'
    ),
    'catalog',jsonb_build_object(
      'total',(select count(*) from public.dramafren_catalog_queue),
      'browse',(select count(*) from public.dramafren_catalog_queue where discovered_from='webfic_browse'),
      'v2_discovered',(select count(*) from public.dramafren_catalog_queue where discovered_from='dramafren_v2'),
      'ready',(select count(*) from public.dramafren_catalog_queue where status='ready'),
      'mapped',(select count(*) from public.content_source_map where source_key='dramafren_webfic'),
      'v2_alias_mapped',(select count(*) from public.content_source_map where source_key='dramafren_v2'),
      'v2_observations',(select count(*) from public.dramafren_v2_observations),
      'v2_unresolved',(select count(*) from public.dramafren_v2_observations where match_status='unresolved')
    ),
    'queue',jsonb_build_object(
      'pending',(select count(*) from public.sync_queue where status='pending'),
      'processing',(select count(*) from public.sync_queue where status='processing'),
      'retry_wait',(select count(*) from public.sync_queue where status='retry_wait'),
      'failed',(select count(*) from public.sync_queue where status='failed'),
      'completed',(select count(*) from public.sync_queue where status='completed')
    ),
    'library',jsonb_build_object(
      'dramas',(select count(*) from public.dramas),
      'episodes',(select count(*) from public.episodes),
      'published_dramas',(select count(*) from public.dramas where published),
      'published_episodes',(select count(*) from public.episodes where published),
      'dramabox_direct_sources',(select count(*) from public.episode_sources where provider='dramabox_web' and active),
      'r2_sources',(select count(*) from public.episode_sources where provider='legacy_r2' and active)
    ),
    'latest_events',(
      select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
      from (
        select event_type,source_content_id,details,occurred_at
        from public.sync_events
        where source_key in ('dramafren_webfic','dramafren_v2')
        order by occurred_at desc
        limit 10
      ) x
    )
  );
$$;

revoke all on function public.get_bingebox_sync_health() from public,anon,authenticated;
grant execute on function public.get_bingebox_sync_health() to service_role;

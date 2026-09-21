-- Keep only currently playable episodes public and refresh expiring provider URLs.

update public.episode_sources
set source_type='hls', updated_at=now()
where source_type <> 'hls'
  and source_url ~* '\.m3u8(?:\?|$)';

do $outer$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname='bingebox-playability-guard' limit 1;
  if jid is null then
    perform cron.schedule(
      'bingebox-playability-guard',
      '*/5 * * * *',
      $guard$
      update public.episode_sources
      set active=false,
          health_status='expired',
          last_failed_at=coalesce(last_failed_at,now()),
          updated_at=now()
      where active=true
        and expires_at is not null
        and expires_at <= now()+interval '2 minutes';

      update public.episodes e
      set published=false,
          publish_at=null,
          video_url=null,
          updated_at=now()
      where e.published=true
        and e.video_key is null
        and not exists (
          select 1 from public.episode_sources s
          where s.episode_id=e.id
            and s.active=true
            and s.health_status in ('healthy','unknown','expiring')
            and (s.expires_at is null or s.expires_at > now()+interval '2 minutes')
        );

      with expired_flick as (
        select distinct s.episode_id
        from public.episode_sources s
        where s.provider='flickreels_web'
          and s.expires_at is not null
          and s.expires_at <= now()+interval '2 minutes'
      ),
      latest_completed as (
        select distinct on (q.payload->>'episode_id') q.id
        from public.sync_queue q
        join expired_flick x on q.payload->>'episode_id'=x.episode_id::text
        where q.source_key='dramafren_flickreels'
          and q.job_type='provider_resolve_media'
          and q.payload ? 'watch_url'
        order by q.payload->>'episode_id',q.updated_at desc
      )
      update public.sync_queue q
      set status='pending',
          attempt_count=0,
          next_retry_at=null,
          last_error=null,
          completed_at=null,
          heartbeat_at=null,
          lease_expires_at=null,
          updated_at=now()
      from latest_completed l
      where q.id=l.id;
      $guard$
    );
  end if;
end
$outer$;

select cron.alter_job(
  (select jobid from cron.job where jobname='bingebox-official-provider-media' limit 1),
  '* * * * *',
  $cmd$
  do $gate$
  begin
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_reelshort'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_reelshort');
    end if;

    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_flickreels'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_flickreels');
    end if;

    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_netshort'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_netshort')
      from generate_series(1,2);
    end if;

    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_shortmax'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_shortmax');
    end if;

    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_goodshort'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_goodshort');
    end if;

    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_starshort'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_starshort');
    end if;
  end
  $gate$;
  $cmd$,
  null,
  null,
  true
);

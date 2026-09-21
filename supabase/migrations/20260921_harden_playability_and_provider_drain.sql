-- BingeBox playability hardening and bounded provider drain.

-- HLS is a first-class source type.
alter table public.episode_sources
  drop constraint if exists episode_sources_source_type_check;
alter table public.episode_sources
  add constraint episode_sources_source_type_check
  check (source_type = any(array['embed'::text,'direct'::text,'hls'::text]));

update public.episode_sources
set source_type='hls', updated_at=now()
where source_type <> 'hls'
  and source_url ~* '\.m3u8(?:\?|$)';

-- Retry legacy provider failures now that source verification/HLS handling is corrected.
update public.sync_queue
set status='pending',
    attempt_count=0,
    next_retry_at=null,
    last_error=null,
    completed_at=null,
    heartbeat_at=null,
    lease_expires_at=null,
    updated_at=now()
where job_type='provider_resolve_media'
  and source_key in ('dramafren_flextv','dramafren_flickreels')
  and status='failed';

update public.sync_queue
set status='pending',
    attempt_count=0,
    next_retry_at=null,
    last_error=null,
    completed_at=null,
    heartbeat_at=null,
    lease_expires_at=null,
    updated_at=now()
where source_key='dramafren_starshort'
  and job_type='provider_resolve_media'
  and status in ('failed','retry_wait')
  and last_error like '%episode_sources_source_type_check%';

-- Faster, demand-gated drain for providers currently completing cleanly.
do $outer$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname='bingebox-official-provider-media' limit 1;
  if jid is not null then
    perform cron.alter_job(
      jid,
      '* * * * *',
      $cmd$
      do $gate$
      begin
        if exists (
          select 1 from public.sync_queue
          where source_key='dramafren_reelshort' and job_type='provider_resolve_media'
            and status in ('pending','retry_wait') and coalesce(next_retry_at,created_at)<=now()
        ) then
          perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_reelshort');
        end if;

        if exists (
          select 1 from public.sync_queue
          where source_key='dramafren_flickreels' and job_type='provider_resolve_media'
            and status in ('pending','retry_wait') and coalesce(next_retry_at,created_at)<=now()
        ) then
          perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_flickreels');
        end if;

        if exists (
          select 1 from public.sync_queue
          where source_key='dramafren_netshort' and job_type='provider_resolve_media'
            and status in ('pending','retry_wait') and coalesce(next_retry_at,created_at)<=now()
        ) then
          perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_netshort')
          from generate_series(1,4);
        end if;

        if exists (
          select 1 from public.sync_queue
          where source_key='dramafren_shortmax' and job_type='provider_resolve_media'
            and status in ('pending','retry_wait') and coalesce(next_retry_at,created_at)<=now()
        ) then
          perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_shortmax')
          from generate_series(1,6);
        end if;

        if exists (
          select 1 from public.sync_queue
          where source_key='dramafren_goodshort' and job_type='provider_resolve_media'
            and status in ('pending','retry_wait') and coalesce(next_retry_at,created_at)<=now()
        ) then
          perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_goodshort')
          from generate_series(1,2);
        end if;

        if exists (
          select 1 from public.sync_queue
          where source_key='dramafren_starshort' and job_type='provider_resolve_media'
            and status in ('pending','retry_wait') and coalesce(next_retry_at,created_at)<=now()
        ) then
          perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_starshort')
          from generate_series(1,8);
        end if;
      end
      $gate$;
      $cmd$,
      null,
      null,
      true
    );
  end if;

  select jobid into jid from cron.job where jobname='bingebox-flextv-media-fast' limit 1;
  if jid is null then
    perform cron.schedule(
      'bingebox-flextv-media-fast',
      '* * * * *',
      $cmd$
      do $gate$
      begin
        if exists (
          select 1 from public.sync_queue
          where source_key='dramafren_flextv'
            and job_type='provider_resolve_media'
            and status in ('pending','retry_wait')
            and coalesce(next_retry_at,created_at)<=now()
        ) then
          perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_flextv')
          from generate_series(1,2);
        end if;
      end
      $gate$;
      $cmd$
    );
  else
    perform cron.alter_job(
      jid,
      '* * * * *',
      $cmd$
      do $gate$
      begin
        if exists (
          select 1 from public.sync_queue
          where source_key='dramafren_flextv'
            and job_type='provider_resolve_media'
            and status in ('pending','retry_wait')
            and coalesce(next_retry_at,created_at)<=now()
        ) then
          perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_flextv')
          from generate_series(1,2);
        end if;
      end
      $gate$;
      $cmd$,
      null,
      null,
      true
    );
  end if;

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
        select distinct on ((q.payload->>'episode_id')) q.id
        from public.sync_queue q
        join expired_flick x on q.payload->>'episode_id'=x.episode_id::text
        where q.source_key='dramafren_flickreels'
          and q.job_type='provider_resolve_media'
          and q.status='completed'
          and q.payload ? 'watch_url'
        order by (q.payload->>'episode_id'),q.updated_at desc
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
  else
    perform cron.alter_job(
      jid,
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
        select distinct on ((q.payload->>'episode_id')) q.id
        from public.sync_queue q
        join expired_flick x on q.payload->>'episode_id'=x.episode_id::text
        where q.source_key='dramafren_flickreels'
          and q.job_type='provider_resolve_media'
          and q.status='completed'
          and q.payload ? 'watch_url'
        order by (q.payload->>'episode_id'),q.updated_at desc
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
      $guard$,
      null,
      null,
      true
    );
  end if;
end
$outer$;

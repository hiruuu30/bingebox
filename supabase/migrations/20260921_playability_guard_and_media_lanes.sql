-- Keep BingeBox public playback free of dead sources and automatically restore
-- episodes that were temporarily quarantined once their source is healthy again.

create table if not exists public.playability_quarantine (
  episode_id uuid primary key references public.episodes(id) on delete cascade,
  quarantined_at timestamptz not null default now(),
  reason text not null default 'no_usable_source'
);

alter table public.playability_quarantine enable row level security;
revoke all on public.playability_quarantine from public,anon,authenticated;
grant all on public.playability_quarantine to service_role;

create index if not exists playability_quarantine_time_idx
on public.playability_quarantine(quarantined_at);

create or replace function public.apply_playability_guard()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_expired int:=0;
  v_quarantined int:=0;
  v_restored int:=0;
  v_requeued int:=0;
begin
  update public.episode_sources
  set active=false,
      health_status='expired',
      last_failed_at=coalesce(last_failed_at,now()),
      updated_at=now()
  where active=true
    and expires_at is not null
    and expires_at<=now()+interval '2 minutes';
  get diagnostics v_expired=row_count;

  insert into public.playability_quarantine(episode_id,quarantined_at,reason)
  select e.id,now(),'no_usable_source'
  from public.episodes e
  where e.published=true
    and e.video_key is null
    and not exists (
      select 1 from public.episode_sources s
      where s.episode_id=e.id
        and s.active=true
        and s.health_status in ('healthy','unknown','expiring')
        and (s.expires_at is null or s.expires_at>now()+interval '2 minutes')
    )
  on conflict(episode_id) do nothing;

  update public.episodes e
  set published=false,publish_at=null,video_url=null,updated_at=now()
  where e.published=true
    and exists(select 1 from public.playability_quarantine q where q.episode_id=e.id);
  get diagnostics v_quarantined=row_count;

  with ready as (
    select q.episode_id
    from public.playability_quarantine q
    where exists (
      select 1 from public.episode_sources s
      where s.episode_id=q.episode_id
        and s.active=true
        and s.health_status in ('healthy','unknown','expiring')
        and (s.expires_at is null or s.expires_at>now()+interval '2 minutes')
    )
  ),
  restored as (
    update public.episodes e
    set published=true,updated_at=now()
    from ready r
    where e.id=r.episode_id
    returning e.id
  )
  select count(*) into v_restored from restored;

  delete from public.playability_quarantine q
  where exists (
    select 1 from public.episodes e
    where e.id=q.episode_id and e.published=true
  );

  with expired_flick as (
    select distinct s.episode_id
    from public.episode_sources s
    where s.provider='flickreels_web'
      and s.expires_at is not null
      and s.expires_at<=now()+interval '2 minutes'
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
  ),
  upd as (
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
    where q.id=l.id
    returning q.id
  )
  select count(*) into v_requeued from upd;

  return jsonb_build_object(
    'expired_sources_disabled',v_expired,
    'episodes_quarantined',v_quarantined,
    'episodes_restored',v_restored,
    'flickreels_refresh_requeued',v_requeued
  );
end;
$$;

revoke all on function public.apply_playability_guard() from public,anon,authenticated;
grant execute on function public.apply_playability_guard() to service_role;

do $$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname='bingebox-playability-guard' limit 1;
  if jid is null then
    perform cron.schedule(
      'bingebox-playability-guard',
      '*/5 * * * *',
      $cmd$select public.apply_playability_guard();$cmd$
    );
  else
    perform cron.alter_job(
      jid,
      '*/5 * * * *',
      $cmd$select public.apply_playability_guard();$cmd$,
      null,null,true
    );
  end if;
end $$;

select cron.alter_job(
  21,
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

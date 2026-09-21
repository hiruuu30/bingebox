-- Strict playability + provider media lanes.
-- A public episode is playable only with legacy R2 or a currently usable episode_sources row.

create or replace function public.get_drama_playable_episodes(p_drama_id uuid)
returns table(
  episode_id uuid,
  drama_id uuid,
  episode_number integer,
  episode_title text,
  duration_seconds integer,
  video_key text,
  video_url text
)
language sql
stable
set search_path to 'public'
as $$
  select
    e.id,
    e.drama_id,
    e.episode_number,
    e.title,
    e.duration_seconds,
    e.video_key,
    e.video_url
  from public.episodes e
  join public.dramas d on d.id=e.drama_id
  where e.drama_id=p_drama_id
    and e.published=true
    and d.published=true
    and (e.publish_at is null or e.publish_at<=now())
    and (d.publish_at is null or d.publish_at<=now())
    and (
      nullif(e.video_key,'') is not null
      or exists (
        select 1
        from public.episode_sources s
        where s.episode_id=e.id
          and s.active=true
          and s.health_status in ('healthy','unknown','expiring')
          and nullif(s.source_url,'') is not null
          and (s.expires_at is null or s.expires_at>now()+interval '2 minutes')
      )
    )
  order by e.episode_number asc;
$$;

create or replace function public.get_random_playable_episodes(p_limit integer default 20)
returns table(
  episode_id uuid,
  drama_id uuid,
  episode_number integer,
  episode_title text,
  duration_seconds integer,
  video_key text,
  video_url text,
  slug text,
  title text,
  poster_url text,
  is_complete boolean
)
language sql
stable
set search_path to 'public'
as $$
  select
    e.id,
    e.drama_id,
    e.episode_number,
    e.title,
    e.duration_seconds,
    e.video_key,
    e.video_url,
    d.slug,
    d.title,
    d.poster_url,
    d.is_complete
  from public.episodes e
  join public.dramas d on d.id=e.drama_id
  where e.published=true
    and d.published=true
    and (e.publish_at is null or e.publish_at<=now())
    and (d.publish_at is null or d.publish_at<=now())
    and (
      nullif(e.video_key,'') is not null
      or exists (
        select 1
        from public.episode_sources s
        where s.episode_id=e.id
          and s.active=true
          and s.health_status in ('healthy','unknown','expiring')
          and nullif(s.source_url,'') is not null
          and (s.expires_at is null or s.expires_at>now()+interval '2 minutes')
      )
    )
  order by random()
  limit greatest(1,least(coalesce(p_limit,20),30));
$$;

-- Ensure the official-provider media cron drains every supported media lane.
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
        and expires_at<=now()+interval '2 minutes';

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
            and nullif(s.source_url,'') is not null
            and (s.expires_at is null or s.expires_at>now()+interval '2 minutes')
        );
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
        and expires_at<=now()+interval '2 minutes';

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
            and nullif(s.source_url,'') is not null
            and (s.expires_at is null or s.expires_at>now()+interval '2 minutes')
        );
      $guard$,
      null,
      null,
      true
    );
  end if;
end
$outer$;

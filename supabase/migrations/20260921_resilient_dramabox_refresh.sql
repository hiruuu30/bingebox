
create or replace function public.enqueue_expiring_dramabox_refresh()
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare n integer:=0;
begin
  with due as (
    select m.source_content_id,
           min(s.expires_at) filter (where s.expires_at is not null) as exp
    from public.content_source_map m
    join public.dramas d on d.id=m.drama_id and d.published
    left join public.episodes e on e.drama_id=d.id
    left join public.episode_sources s on s.episode_id=e.id
      and s.provider='dramabox_web'
    where m.source_key='dramafren_webfic'
    group by m.source_content_id
    having
      bool_or(
        s.id is not null and (
          not coalesce(s.active,false)
          or s.health_status in ('expired','failed')
          or (s.expires_at is not null and s.expires_at <= now()+interval '3 hours')
        )
      )
      or bool_or(
        e.id is not null
        and e.published
        and coalesce(e.video_key,'')=''
        and not exists (
          select 1 from public.episode_sources sx
          where sx.episode_id=e.id
            and sx.active
            and sx.provider in ('dramabox_web','legacy_r2')
        )
      )
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
        floor(extract(epoch from now())/1800)::bigint::text,
      jsonb_build_object('refresh',true,'observed_expiry',exp),
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

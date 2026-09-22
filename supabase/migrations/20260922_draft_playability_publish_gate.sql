-- Draft publication gate: only promote newly discovered titles after a contiguous playable opening set exists.
-- Policy:
-- - For titles with >= 10 episodes: Episodes 1-10 must all be usable.
-- - For complete titles with < 10 episodes: every episode must be usable.
-- - A usable episode has an R2 video_key or an active, nonexpired source with accepted health state.
-- - Existing published titles are not retroactively unpublished by this gate.

create or replace function private.autopublish_ready_dramas(
  p_required_prefix integer default 10,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_promoted integer := 0;
begin
  with draft_meta as (
    select d.id,d.title,d.is_complete,max(e.episode_number)::integer as max_episode
    from public.dramas d
    join public.episodes e on e.drama_id=d.id
    where d.published=false
    group by d.id,d.title,d.is_complete
  ),
  slots as (
    select
      m.id,m.title,m.is_complete,m.max_episode,g.n,e.id as episode_id,
      (
        e.id is not null
        and (
          e.video_key is not null
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
      ) as usable
    from draft_meta m
    cross join lateral generate_series(1,m.max_episode) g(n)
    left join public.episodes e
      on e.drama_id=m.id and e.episode_number=g.n
    where m.max_episode>=p_required_prefix
       or (m.is_complete=true and m.max_episode>0)
  ),
  rollup as (
    select
      id,min(title) as title,max(max_episode)::integer as max_episode,
      case when max(max_episode)>=p_required_prefix then p_required_prefix else max(max_episode)::integer end as required_prefix,
      (coalesce(min(n) filter(where not usable),max(max_episode)+1)-1)::integer as playable_prefix
    from slots
    group by id
  ),
  eligible as (
    select *
    from rollup
    where required_prefix>0 and playable_prefix>=required_prefix
    order by id
    limit greatest(1,least(coalesce(p_limit,100),500))
  ),
  published_episodes as (
    update public.episodes e
    set published=true,publish_at=null,updated_at=now()
    from eligible x
    where e.drama_id=x.id
      and e.episode_number between 1 and x.playable_prefix
      and (
        e.video_key is not null
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
    returning e.id,e.drama_id
  ),
  published_dramas as (
    update public.dramas d
    set published=true,publish_at=null,updated_at=now()
    from eligible x
    where d.id=x.id and d.published=false
    returning d.id,d.title
  )
  insert into public.publication_audit_log(
    occurred_at,actor_user_id,action,entity_type,entity_id,drama_id,details
  )
  select
    now(),null,'drama_auto_published','dramas',pd.id,pd.id,
    jsonb_build_object(
      'title',pd.title,
      'policy','playable_prefix',
      'required_prefix',x.required_prefix,
      'playable_prefix',x.playable_prefix,
      'max_episode',x.max_episode,
      'note','Auto-published only after sufficient contiguous playable episodes were available.'
    )
  from published_dramas pd
  join eligible x on x.id=pd.id;

  get diagnostics v_promoted = row_count;

  return jsonb_build_object(
    'promoted_titles',v_promoted,
    'required_prefix',p_required_prefix,
    'policy','First 10 episodes must be continuously playable; complete titles shorter than 10 require every episode playable.'
  );
end;
$$;

revoke all on function private.autopublish_ready_dramas(integer,integer)
from public,anon,authenticated;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='bingebox-auto-publish-ready' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end
$$;

select cron.schedule(
  'bingebox-auto-publish-ready',
  '6,16,26,36,46,56 * * * *',
  'select private.autopublish_ready_dramas();'
);

-- BingeBox v24.7 low-egress playback RPCs.
-- These functions are already deployed to production project shffgnuprnycqblpwkrp.

create or replace function public.get_random_playable_episodes(p_limit integer default 20)
returns table(
  episode_id uuid, drama_id uuid, episode_number integer, episode_title text,
  duration_seconds integer, video_key text, video_url text, slug text,
  title text, poster_url text, is_complete boolean
)
language sql stable security invoker set search_path = public
as $$
  select e.id,e.drama_id,e.episode_number,e.title,e.duration_seconds,e.video_key,e.video_url,
         d.slug,d.title,d.poster_url,d.is_complete
  from public.episodes e
  join public.dramas d on d.id=e.drama_id
  where e.published=true and d.published=true
    and (e.publish_at is null or e.publish_at<=now())
    and (d.publish_at is null or d.publish_at<=now())
    and (nullif(e.video_key,'') is not null or nullif(e.video_url,'') is not null or exists(
      select 1 from public.episode_sources s
      where s.episode_id=e.id and s.active=true and nullif(s.source_url,'') is not null
    ))
  order by random()
  limit greatest(1,least(coalesce(p_limit,20),30));
$$;
grant execute on function public.get_random_playable_episodes(integer) to anon, authenticated;

create or replace function public.get_drama_playable_episodes(p_drama_id uuid)
returns table(
  episode_id uuid, drama_id uuid, episode_number integer, episode_title text,
  duration_seconds integer, video_key text, video_url text
)
language sql stable security invoker set search_path = public
as $$
  select e.id,e.drama_id,e.episode_number,e.title,e.duration_seconds,e.video_key,e.video_url
  from public.episodes e
  join public.dramas d on d.id=e.drama_id
  where e.drama_id=p_drama_id and e.published=true and d.published=true
    and (e.publish_at is null or e.publish_at<=now())
    and (d.publish_at is null or d.publish_at<=now())
    and (nullif(e.video_key,'') is not null or nullif(e.video_url,'') is not null or exists(
      select 1 from public.episode_sources s
      where s.episode_id=e.id and s.active=true and nullif(s.source_url,'') is not null
    ))
  order by e.episode_number asc;
$$;
grant execute on function public.get_drama_playable_episodes(uuid) to anon, authenticated;

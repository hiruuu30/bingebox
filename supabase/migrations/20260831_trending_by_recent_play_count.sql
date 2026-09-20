create or replace function public.get_bingebox_trending(p_hours integer default 72, p_limit integer default 10)
returns table(
  drama_id uuid,
  title text,
  score numeric,
  qualified_viewers bigint,
  measured_watch_minutes numeric,
  completion_rate numeric,
  growth_velocity numeric
)
language sql
security definer
set search_path = public
as $function$
with params as (
  select greatest(24,least(coalesce(p_hours,72),168))::int as hrs,
         greatest(1,least(coalesce(p_limit,10),30))::int as lim
), base as (
  select a.*,
         coalesce(a.user_id::text,a.visitor_token::text) as actor,
         extract(epoch from (now()-a.created_at))/3600.0 as age_hours
  from public.analytics_events a cross join params p
  where a.created_at >= now() - make_interval(hours=>p.hrs)
    and a.drama_id is not null
), agg as (
  select d.id drama_id,d.title,
    count(*) filter (where b.event_type='watch_start')::numeric as play_count,
    count(distinct b.actor) filter (where b.event_type='watch_qualified')::bigint as qualified_viewers,
    coalesce(sum(b.value_numeric) filter (where b.event_type='watch_time'),0)::numeric as watch_seconds,
    count(*) filter (where b.event_type='watch_start')::numeric as starts,
    count(*) filter (where b.event_type='watch_complete')::numeric as completions,
    count(distinct b.actor) filter (where b.event_type='watch_start' and b.age_hours<=24)::numeric as recent_viewers,
    count(distinct b.actor) filter (where b.event_type='watch_start' and b.age_hours>24 and b.age_hours<=48)::numeric as prior_viewers
  from public.dramas d
  left join base b on b.drama_id=d.id
  where d.published=true
  group by d.id,d.title
), ranked as (
  select a.*,
    least(1,coalesce(completions/nullif(starts,0),0))::numeric as completion_rate,
    least(2,greatest(-1,(recent_viewers-prior_viewers)/greatest(prior_viewers,1)))::numeric as growth_velocity,
    row_number() over(
      order by play_count desc,
               qualified_viewers desc,
               watch_seconds desc,
               d_title_sort
    ) rn
  from (
    select agg.*, lower(title) as d_title_sort
    from agg
  ) a
)
select r.drama_id,
       r.title,
       r.play_count::numeric as score,
       r.qualified_viewers,
       round(r.watch_seconds/60.0,1),
       round(r.completion_rate*100,1),
       round(r.growth_velocity*100,1)
from ranked r cross join params p
where r.rn<=p.lim
order by r.rn;
$function$;

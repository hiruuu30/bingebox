-- Optimize advanced catalog search by narrowing fuzzy scoring to indexed candidates.
create index if not exists dramas_genre_trgm_idx
on public.dramas using gin (lower(genre) extensions.gin_trgm_ops)
where published=true;

create or replace function public.search_bingebox_dramas(
  p_query text,
  p_limit integer default 30,
  p_genre text default null,
  p_complete boolean default null,
  p_r18 boolean default null
)
returns table(
  id uuid, slug text, title text, genre text, mood text[], description text, poster_url text,
  featured boolean, sort_order integer, created_at timestamptz, updated_at timestamptz,
  is_complete boolean, publish_at timestamptz, is_r18 boolean, score real, match_reason text
)
language plpgsql
stable
security invoker
set search_path = public, pg_catalog, extensions
as $$
declare
  v_q text := trim(coalesce(p_query,''));
  v_ql text := lower(trim(coalesce(p_query,'')));
  v_limit integer := least(greatest(coalesce(p_limit,30),1),50);
  v_webq tsquery;
  v_prefix_text text;
  v_prefixq tsquery;
begin
  if v_q = '' then
    return query
    select
      d.id,d.slug,d.title,d.genre,d.mood,d.description,d.poster_url,d.featured,d.sort_order,
      d.created_at,d.updated_at,d.is_complete,d.publish_at,d.is_r18,
      (
        case when d.featured then 2 else 0 end
        + greatest(0,1-least(1,extract(epoch from (now()-coalesce(d.updated_at,d.created_at,now())))/86400.0/90.0))
      )::real,
      case when d.featured then 'Featured' else 'Popular on BingeBox' end::text
    from public.dramas d
    where d.published=true
      and (d.publish_at is null or d.publish_at<=now())
      and (p_genre is null or p_genre='' or lower(d.genre)=lower(p_genre))
      and (p_complete is null or d.is_complete=p_complete)
      and (p_r18 is null or d.is_r18=p_r18)
    order by d.featured desc,d.sort_order asc,coalesce(d.updated_at,d.created_at) desc
    limit v_limit;
    return;
  end if;

  v_webq := websearch_to_tsquery('simple', v_q);
  select string_agg(cleaned || ':*', ' & ') into v_prefix_text
  from (
    select regexp_replace(tok, '[^[:alnum:]'']', '', 'g') as cleaned
    from regexp_split_to_table(lower(v_q), E'\\s+') tok
  ) s
  where cleaned <> '';
  if nullif(v_prefix_text,'') is not null then v_prefixq := to_tsquery('simple',v_prefix_text); end if;

  return query
  with raw_candidates as materialized (
    select d.id from public.dramas d
    where d.published=true and v_webq is not null and d.search_vector @@ v_webq
    union
    select d.id from public.dramas d
    where d.published=true and v_prefixq is not null and d.search_vector @@ v_prefixq
    union
    select d.id from public.dramas d
    where d.published=true and lower(d.title) like '%' || v_ql || '%'
    union
    select d.id from public.dramas d
    where d.published=true and length(v_ql)>=3 and lower(d.title) % v_ql
    union
    select d.id from public.dramas d
    where d.published=true and lower(coalesce(d.genre,'')) like '%' || v_ql || '%'
    union
    select d.id from public.dramas d
    where d.published=true and length(v_ql)>=3 and lower(coalesce(d.genre,'')) % v_ql
  ),
  candidates as (
    select d.*
    from raw_candidates r
    join public.dramas d on d.id=r.id
    where (d.publish_at is null or d.publish_at<=now())
      and (p_genre is null or p_genre='' or lower(d.genre)=lower(p_genre))
      and (p_complete is null or d.is_complete=p_complete)
      and (p_r18 is null or d.is_r18=p_r18)
  ),
  scored as (
    select d.*,
      (
          case when lower(d.title)=v_ql then 100 else 0 end
        + case when lower(d.title) like v_ql || '%' then 38 else 0 end
        + case when lower(d.title) like '%' || v_ql || '%' then 24 else 0 end
        + case when lower(coalesce(d.genre,'')) = v_ql then 20 else 0 end
        + case when lower(coalesce(d.genre,'')) like '%' || v_ql || '%' then 10 else 0 end
        + case when exists(select 1 from unnest(coalesce(d.mood,'{}'::text[])) m where lower(m)=v_ql) then 16 else 0 end
        + case when exists(select 1 from unnest(coalesce(d.mood,'{}'::text[])) m where lower(m) like '%' || v_ql || '%') then 7 else 0 end
        + coalesce(ts_rank_cd(d.search_vector,v_webq,32),0) * 34
        + coalesce(ts_rank_cd(d.search_vector,v_prefixq,32),0) * 20
        + case when length(v_ql)>=3 then extensions.similarity(lower(d.title),v_ql) * 26 else 0 end
        + case when length(v_ql)>=3 then extensions.word_similarity(v_ql,lower(d.title)) * 16 else 0 end
        + case when length(v_ql)>=3 then extensions.similarity(lower(coalesce(d.genre,'')),v_ql) * 7 else 0 end
        + case when d.featured then 0.8 else 0 end
        + greatest(0,0.35-least(0.35,extract(epoch from (now()-coalesce(d.updated_at,d.created_at,now())))/86400.0/180.0))
      )::real as search_score,
      case
        when lower(d.title)=v_ql then 'Exact title'
        when lower(d.title) like v_ql || '%' then 'Title starts with your search'
        when lower(d.title) like '%' || v_ql || '%' then 'Title match'
        when lower(coalesce(d.genre,'')) = v_ql then 'Genre match'
        when exists(select 1 from unnest(coalesce(d.mood,'{}'::text[])) m where lower(m)=v_ql) then 'Mood match'
        when length(v_ql)>=3 and extensions.similarity(lower(d.title),v_ql)>=0.18 then 'Similar title'
        when v_webq is not null and d.search_vector @@ v_webq then 'Story match'
        when v_prefixq is not null and d.search_vector @@ v_prefixq then 'Partial match'
        else 'Related match'
      end as reason
    from candidates d
  )
  select s.id,s.slug,s.title,s.genre,s.mood,s.description,s.poster_url,s.featured,s.sort_order,
         s.created_at,s.updated_at,s.is_complete,s.publish_at,s.is_r18,s.search_score,s.reason
  from scored s
  order by s.search_score desc,s.featured desc,s.sort_order asc,coalesce(s.updated_at,s.created_at) desc
  limit v_limit;
end;
$$;

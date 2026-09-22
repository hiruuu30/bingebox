-- Advanced BingeBox catalog search: indexed FTS + typo-tolerant title ranking.
create extension if not exists pg_trgm with schema extensions;

alter table public.dramas
  add column if not exists search_vector tsvector;

create or replace function public.dramas_search_vector_update()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.search_vector :=
      setweight(to_tsvector('simple', coalesce(new.title,'')), 'A')
    || setweight(to_tsvector('simple', coalesce(new.genre,'')), 'B')
    || setweight(to_tsvector('simple', coalesce(array_to_string(new.mood,' '),'')), 'B')
    || setweight(to_tsvector('simple', coalesce(new.description,'')), 'C');
  return new;
end;
$$;

update public.dramas
set search_vector =
      setweight(to_tsvector('simple', coalesce(title,'')), 'A')
    || setweight(to_tsvector('simple', coalesce(genre,'')), 'B')
    || setweight(to_tsvector('simple', coalesce(array_to_string(mood,' '),'')), 'B')
    || setweight(to_tsvector('simple', coalesce(description,'')), 'C');

drop trigger if exists dramas_search_vector_tg on public.dramas;
create trigger dramas_search_vector_tg
before insert or update of title,genre,mood,description
on public.dramas
for each row execute function public.dramas_search_vector_update();

create index if not exists dramas_search_vector_idx
on public.dramas using gin(search_vector)
where published=true;

create index if not exists dramas_title_trgm_idx
on public.dramas using gin (lower(title) extensions.gin_trgm_ops)
where published=true;

create or replace function public.search_bingebox_dramas(
  p_query text,
  p_limit integer default 30,
  p_genre text default null,
  p_complete boolean default null,
  p_r18 boolean default null
)
returns table(
  id uuid,slug text,title text,genre text,mood text[],description text,poster_url text,
  featured boolean,sort_order integer,created_at timestamptz,updated_at timestamptz,
  is_complete boolean,publish_at timestamptz,is_r18 boolean,score real,match_reason text
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
  if v_q <> '' then
    v_webq := websearch_to_tsquery('simple', v_q);
    select string_agg(cleaned || ':*', ' & ') into v_prefix_text
    from (
      select regexp_replace(tok, '[^[:alnum:]'']', '', 'g') as cleaned
      from regexp_split_to_table(lower(v_q), E'\\s+') tok
    ) s
    where cleaned <> '';
    if nullif(v_prefix_text,'') is not null then v_prefixq := to_tsquery('simple', v_prefix_text); end if;
  end if;

  return query
  with candidates as (
    select d.*,
      (
        case when v_q = '' then 0 else
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
        end
        + case when d.featured then 0.8 else 0 end
        + greatest(0,0.35-least(0.35,extract(epoch from (now()-coalesce(d.updated_at,d.created_at,now())))/86400.0/180.0))
      )::real as search_score,
      case
        when v_q='' then case when d.featured then 'Featured' else 'Popular on BingeBox' end
        when lower(d.title)=v_ql then 'Exact title'
        when lower(d.title) like v_ql || '%' then 'Title starts with your search'
        when lower(d.title) like '%' || v_ql || '%' then 'Title match'
        when lower(coalesce(d.genre,'')) = v_ql then 'Genre match'
        when exists(select 1 from unnest(coalesce(d.mood,'{}'::text[])) m where lower(m)=v_ql) then 'Mood match'
        when length(v_ql)>=3 and extensions.similarity(lower(d.title),v_ql)>=0.18 then 'Similar title'
        when d.search_vector @@ v_webq then 'Story match'
        when d.search_vector @@ v_prefixq then 'Partial match'
        else 'Related match'
      end as reason
    from public.dramas d
    where d.published=true
      and (d.publish_at is null or d.publish_at<=now())
      and (p_genre is null or p_genre='' or lower(d.genre)=lower(p_genre))
      and (p_complete is null or d.is_complete=p_complete)
      and (p_r18 is null or d.is_r18=p_r18)
      and (
        v_q=''
        or lower(d.title) like '%' || v_ql || '%'
        or lower(coalesce(d.genre,'')) like '%' || v_ql || '%'
        or exists(select 1 from unnest(coalesce(d.mood,'{}'::text[])) m where lower(m) like '%' || v_ql || '%')
        or (v_webq is not null and d.search_vector @@ v_webq)
        or (v_prefixq is not null and d.search_vector @@ v_prefixq)
        or (length(v_ql)>=3 and (
          extensions.similarity(lower(d.title),v_ql)>=0.16
          or extensions.word_similarity(v_ql,lower(d.title))>=0.36
          or extensions.similarity(lower(coalesce(d.genre,'')),v_ql)>=0.28
        ))
      )
  )
  select c.id,c.slug,c.title,c.genre,c.mood,c.description,c.poster_url,c.featured,c.sort_order,
         c.created_at,c.updated_at,c.is_complete,c.publish_at,c.is_r18,c.search_score,c.reason
  from candidates c
  order by c.search_score desc,c.featured desc,c.sort_order asc,coalesce(c.updated_at,c.created_at) desc
  limit v_limit;
end;
$$;

revoke all on function public.search_bingebox_dramas(text,integer,text,boolean,boolean) from public;
grant execute on function public.search_bingebox_dramas(text,integer,text,boolean,boolean) to anon, authenticated;

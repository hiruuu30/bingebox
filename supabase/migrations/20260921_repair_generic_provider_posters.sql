-- Treat generic provider artwork as missing and repair GoodShort posters from official detail metadata.
-- Applied live on 2026-09-21.

create or replace function public.repair_goodshort_real_posters(p_limit int default 25)
returns jsonb
language plpgsql
security definer
set search_path='public','extensions'
as $$
declare
  rec record;
  resp extensions.http_response;
  img text;
  checked int:=0;
  fixed int:=0;
  failed int:=0;
begin
  for rec in
    select d.id drama_id,o.id observation_id,o.source_url,o.source_content_id
    from public.dramafren_source_observations o
    join public.dramas d on d.id=o.canonical_drama_id
    where o.source_key='dramafren_goodshort'
      and o.source_url is not null
      and (
        d.poster_url is null or btrim(d.poster_url)='' or
        d.poster_url ilike '%default-book-cover%'
      )
    order by o.last_seen_at desc nulls last
    limit greatest(1,least(p_limit,50))
  loop
    checked:=checked+1;
    img:=null;
    begin
      resp:=extensions.http_get(rec.source_url);
      if resp.status=200 and resp.content is not null then
        img:=(regexp_match(resp.content,
          '<meta[^>]+property=["'']og:image["''][^>]+content=["'']([^"'']+)["'']','i'))[1];
        if img is null then
          img:=(regexp_match(resp.content,
            '<meta[^>]+content=["'']([^"'']+)["''][^>]+property=["'']og:image["'']','i'))[1];
        end if;
        if img is null then
          img:=(regexp_match(resp.content,
            '"@type"\s*:\s*"TVSeries".{0,2500}?"image"\s*:\s*"(https?://[^"]+)"','is'))[1];
        end if;
        if img is null then
          img:=(regexp_match(resp.content,
            '"@type"\s*:\s*"ImageObject".{0,1200}?"contentUrl"\s*:\s*"(https?://[^"]+)"','is'))[1];
        end if;
      end if;
    exception when others then
      img:=null;
    end;

    if img is not null
       and img ~ '^https?://'
       and img not ilike '%default-book-cover%' then
      img:=replace(img,'&amp;','&');

      update public.dramas
      set poster_url=img,updated_at=now()
      where id=rec.drama_id;

      update public.dramafren_source_observations
      set metadata=coalesce(metadata,'{}'::jsonb)||
          jsonb_build_object(
            'cover_url',img,
            'poster_source','goodshort_detail_og',
            'poster_backfilled_at',now()
          ),
          last_seen_at=greatest(coalesce(last_seen_at,now()),now())
      where id=rec.observation_id;

      update public.content_source_map
      set metadata=coalesce(metadata,'{}'::jsonb)||
          jsonb_build_object(
            'cover_url',img,
            'poster_source','goodshort_detail_og'
          ),
          last_seen_at=greatest(coalesce(last_seen_at,now()),now())
      where source_key='dramafren_goodshort'
        and source_content_id=rec.source_content_id;

      fixed:=fixed+1;
    else
      failed:=failed+1;
    end if;
  end loop;

  return jsonb_build_object(
    'checked',checked,'fixed',fixed,'failed',failed,
    'remaining',(
      select count(*)
      from public.dramas d
      join public.dramafren_source_observations o on o.canonical_drama_id=d.id
      where o.source_key='dramafren_goodshort'
        and d.poster_url ilike '%default-book-cover%'
    )
  );
end;
$$;

create or replace function public.hydrate_drama_poster_from_observation()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_cover text;
begin
  if new.canonical_drama_id is null then return new; end if;
  v_cover:=nullif(btrim(coalesce(
    new.metadata->>'cover_url',
    new.metadata->>'poster_url',
    new.metadata->>'coverImgUrl',
    new.metadata->>'image',
    new.metadata->>'thumbnail_url',
    ''
  )),'');
  if v_cover !~ '^https?://' then return new; end if;
  if v_cover ilike '%default-book-cover%'
     or v_cover ilike '%placeholder%'
     or v_cover ilike '%/assets/brand/mark.svg%' then
    return new;
  end if;

  update public.dramas
  set poster_url=v_cover,updated_at=now()
  where id=new.canonical_drama_id
    and (
      poster_url is null or btrim(poster_url)='' or
      poster_url ilike '%default-book-cover%' or
      poster_url ilike '%placeholder%' or
      poster_url ilike '%/assets/brand/mark.svg%'
    );
  return new;
end;
$$;

create or replace function public.hydrate_drama_poster_from_source_map()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_cover text;
begin
  if new.drama_id is null then return new; end if;
  v_cover:=nullif(btrim(coalesce(
    new.metadata->>'cover_url',
    new.metadata->>'poster_url',
    new.metadata->>'coverImgUrl',
    new.metadata->>'image',
    new.metadata->>'thumbnail_url',
    ''
  )),'');
  if v_cover !~ '^https?://' then return new; end if;
  if v_cover ilike '%default-book-cover%'
     or v_cover ilike '%placeholder%'
     or v_cover ilike '%/assets/brand/mark.svg%' then
    return new;
  end if;

  update public.dramas
  set poster_url=v_cover,updated_at=now()
  where id=new.drama_id
    and (
      poster_url is null or btrim(poster_url)='' or
      poster_url ilike '%default-book-cover%' or
      poster_url ilike '%placeholder%' or
      poster_url ilike '%/assets/brand/mark.svg%'
    );
  return new;
end;
$$;

revoke all on function public.repair_goodshort_real_posters(int) from public,anon,authenticated;
grant execute on function public.repair_goodshort_real_posters(int) to service_role;

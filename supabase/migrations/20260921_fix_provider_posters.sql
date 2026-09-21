-- Fix provider poster hydration and automatically repair missing artwork.
-- Live-applied on 2026-09-21; this migration makes the hotfix reproducible.

create or replace function public.backfill_provider_posters(p_source_key text, p_limit int default 25)
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
    select d.id drama_id,o.id observation_id,o.source_url,o.metadata
    from public.dramafren_source_observations o
    join public.dramas d on d.id=o.canonical_drama_id
    where o.source_key=p_source_key
      and o.source_url is not null
      and (d.poster_url is null or btrim(d.poster_url)='')
    order by o.last_seen_at desc nulls last
    limit greatest(1,least(p_limit,100))
  loop
    checked:=checked+1;
    img:=null;
    begin
      resp:=extensions.http_get(rec.source_url);
      if resp.status=200 and resp.content is not null then
        img:=(regexp_match(resp.content,'<meta[^>]+property=["'']og:image["''][^>]+content=["'']([^"'']+)["'']','i'))[1];
        if img is null then
          img:=(regexp_match(resp.content,'<meta[^>]+content=["'']([^"'']+)["''][^>]+property=["'']og:image["'']','i'))[1];
        end if;
        if img is null then
          img:=(regexp_match(resp.content,'"image"\\s*:\\s*"(https?://[^"]+)"','i'))[1];
        end if;
        if img is null then
          img:=(regexp_match(resp.content,'"thumbnailUrl"\\s*:\\s*"(https?://[^"]+)"','i'))[1];
        end if;
        if img is null then
          img:=(regexp_match(resp.content,'"contentUrl"\\s*:\\s*"(https?://[^"]+\\.(?:jpg|jpeg|png|webp)[^"]*)"','i'))[1];
        end if;
      end if;
    exception when others then
      img:=null;
    end;

    if img is not null and img ~ '^https?://' then
      img:=replace(img,'&amp;','&');
      update public.dramas
      set poster_url=img,updated_at=now()
      where id=rec.drama_id and (poster_url is null or btrim(poster_url)='');

      update public.dramafren_source_observations
      set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cover_url',img,'poster_backfilled_at',now()),
          last_seen_at=greatest(coalesce(last_seen_at,now()),now())
      where id=rec.observation_id;

      update public.content_source_map
      set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cover_url',img),
          last_seen_at=greatest(coalesce(last_seen_at,now()),now())
      where source_key=p_source_key and drama_id=rec.drama_id;
      fixed:=fixed+1;
    else
      failed:=failed+1;
    end if;
  end loop;

  return jsonb_build_object('source_key',p_source_key,'checked',checked,'fixed',fixed,'failed',failed);
end;
$$;

create or replace function public.sync_anamana_posters()
returns jsonb
language plpgsql
security definer
set search_path='public','extensions'
as $$
declare
  v_html text;
  v_resp extensions.http_response;
  v_cards int:=0;
  v_dramas int:=0;
  v_obs int:=0;
  v_maps int:=0;
begin
  v_resp:=extensions.http_get('https://www.reelfren.com/explore?lang=en&provider=anamana');
  if v_resp.status<>200 or v_resp.content is null then
    raise exception 'Anamana catalog HTTP %',v_resp.status;
  end if;
  v_html:=v_resp.content;

  create temporary table if not exists tmp_anamana_posters(
    source_content_id text primary key,
    title text not null,
    poster_url text not null
  ) on commit drop;
  truncate tmp_anamana_posters;

  insert into tmp_anamana_posters(source_content_id,title,poster_url)
  select m[1],
         replace(replace(m[3],'&#x27;',''''),'&amp;','&'),
         replace(m[2],'&amp;','&')
  from regexp_matches(
    v_html,
    '<a href="/drama/anamana/([0-9]+)-[^"]+\\?lang=en"><div class="poster-frame scanline"><img src="([^"]+)" alt="Poster ([^"]+)"',
    'g'
  ) m
  on conflict(source_content_id) do update
  set title=excluded.title,poster_url=excluded.poster_url;

  get diagnostics v_cards=row_count;

  with targets as (
    select distinct o.canonical_drama_id drama_id,p.poster_url,p.title,p.source_content_id
    from public.dramafren_source_observations o
    join tmp_anamana_posters p on p.source_content_id=o.source_content_id
    where o.source_key in ('dramafren_dramawave','dramafren_moboreels','dramafren_viglo')
      and o.canonical_drama_id is not null
  ),
  upd as (
    update public.dramas d
    set poster_url=t.poster_url,updated_at=now()
    from targets t
    where d.id=t.drama_id and d.poster_url is distinct from t.poster_url
    returning d.id
  )
  select count(*) into v_dramas from upd;

  update public.dramafren_source_observations o
  set source_title=p.title,
      metadata=coalesce(o.metadata,'{}'::jsonb)||
        jsonb_build_object('cover_url',p.poster_url,'poster_source','anamana_catalog','poster_backfilled_at',now()),
      last_seen_at=greatest(coalesce(o.last_seen_at,now()),now())
  from tmp_anamana_posters p
  where o.source_content_id=p.source_content_id
    and o.source_key in ('dramafren_dramawave','dramafren_moboreels','dramafren_viglo');
  get diagnostics v_obs=row_count;

  update public.content_source_map m
  set metadata=coalesce(m.metadata,'{}'::jsonb)||
        jsonb_build_object('cover_url',p.poster_url,'poster_source','anamana_catalog'),
      last_seen_at=greatest(coalesce(m.last_seen_at,now()),now())
  from tmp_anamana_posters p
  where m.source_content_id=p.source_content_id
    and m.source_key in ('dramafren_dramawave','dramafren_moboreels','dramafren_viglo');
  get diagnostics v_maps=row_count;

  insert into public.sync_events(source_key,event_type,details)
  values('dramafren_anamana','poster_sync',
    jsonb_build_object('cards',v_cards,'dramas_updated',v_dramas,'observations_updated',v_obs,'maps_updated',v_maps));

  return jsonb_build_object('ok',true,'cards',v_cards,'dramas_updated',v_dramas,'observations_updated',v_obs,'maps_updated',v_maps);
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

  update public.dramas
  set poster_url=v_cover,updated_at=now()
  where id=new.canonical_drama_id
    and (poster_url is null or btrim(poster_url)='');
  return new;
end;
$$;

drop trigger if exists trg_hydrate_drama_poster_observation
on public.dramafren_source_observations;

create trigger trg_hydrate_drama_poster_observation
after insert or update of canonical_drama_id,metadata
on public.dramafren_source_observations
for each row execute function public.hydrate_drama_poster_from_observation();

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

  update public.dramas
  set poster_url=v_cover,updated_at=now()
  where id=new.drama_id
    and (poster_url is null or btrim(poster_url)='');
  return new;
end;
$$;

drop trigger if exists trg_hydrate_drama_poster_source_map
on public.content_source_map;

create trigger trg_hydrate_drama_poster_source_map
after insert or update of drama_id,metadata
on public.content_source_map
for each row execute function public.hydrate_drama_poster_from_source_map();

create or replace function public.repair_missing_provider_posters()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_anamana jsonb:=null;
  v_goodshort jsonb:=null;
  v_reelshort jsonb:=null;
  v_meta_fixed int:=0;
begin
  with donor as (
    select distinct on (o.canonical_drama_id)
      o.canonical_drama_id drama_id,
      coalesce(
        nullif(o.metadata->>'cover_url',''),
        nullif(o.metadata->>'poster_url',''),
        nullif(o.metadata->>'coverImgUrl',''),
        nullif(o.metadata->>'image',''),
        nullif(o.metadata->>'thumbnail_url','')
      ) cover_url
    from public.dramafren_source_observations o
    join public.dramas d on d.id=o.canonical_drama_id
    where o.canonical_drama_id is not null
      and (d.poster_url is null or btrim(d.poster_url)='')
      and coalesce(
        nullif(o.metadata->>'cover_url',''),
        nullif(o.metadata->>'poster_url',''),
        nullif(o.metadata->>'coverImgUrl',''),
        nullif(o.metadata->>'image',''),
        nullif(o.metadata->>'thumbnail_url','')
      ) ~ '^https?://'
    order by o.canonical_drama_id,o.last_seen_at desc nulls last
  ),
  upd as (
    update public.dramas d
    set poster_url=donor.cover_url,updated_at=now()
    from donor
    where d.id=donor.drama_id
    returning d.id
  )
  select count(*) into v_meta_fixed from upd;

  if exists(
    select 1
    from public.dramafren_source_observations o
    join public.dramas d on d.id=o.canonical_drama_id
    where o.source_key in ('dramafren_dramawave','dramafren_moboreels','dramafren_viglo')
      and o.source_content_id ~ '^[0-9]+$'
      and (d.poster_url is null or btrim(d.poster_url)='')
  ) then
    v_anamana:=public.sync_anamana_posters();
  end if;

  if exists(
    select 1 from public.dramafren_source_observations o
    join public.dramas d on d.id=o.canonical_drama_id
    where o.source_key='dramafren_goodshort'
      and (d.poster_url is null or btrim(d.poster_url)='')
  ) then
    v_goodshort:=public.backfill_provider_posters('dramafren_goodshort',50);
  end if;

  if exists(
    select 1 from public.dramafren_source_observations o
    join public.dramas d on d.id=o.canonical_drama_id
    where o.source_key='dramafren_reelshort'
      and (d.poster_url is null or btrim(d.poster_url)='')
  ) then
    v_reelshort:=public.backfill_provider_posters('dramafren_reelshort',50);
  end if;

  return jsonb_build_object(
    'ok',true,'metadata_fixed',v_meta_fixed,'anamana',v_anamana,
    'goodshort',v_goodshort,'reelshort',v_reelshort,
    'remaining',(select count(*) from public.dramas where poster_url is null or btrim(poster_url)='')
  );
end;
$$;

revoke all on function public.backfill_provider_posters(text,int) from public,anon,authenticated;
revoke all on function public.sync_anamana_posters() from public,anon,authenticated;
revoke all on function public.hydrate_drama_poster_from_observation() from public,anon,authenticated;
revoke all on function public.hydrate_drama_poster_from_source_map() from public,anon,authenticated;
revoke all on function public.repair_missing_provider_posters() from public,anon,authenticated;

grant execute on function public.backfill_provider_posters(text,int) to service_role;
grant execute on function public.sync_anamana_posters() to service_role;
grant execute on function public.repair_missing_provider_posters() to service_role;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='bingebox-poster-repair';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

select cron.schedule(
  'bingebox-poster-repair',
  '*/5 * * * *',
  $cmd$select public.repair_missing_provider_posters();$cmd$
);

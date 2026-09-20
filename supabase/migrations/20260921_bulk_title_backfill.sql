
with candidates as materialized (
  select
    q.book_id,
    gen_random_uuid() as drama_id,
    coalesce(nullif(q.title,''),'Drama '||q.book_id) as title,
    coalesce(q.description,'') as description,
    q.cover_url,
    q.tags,
    q.canonical_url,
    q.metadata
  from public.dramafren_catalog_queue q
  left join public.content_source_map m
    on m.source_key='dramafren_webfic'
   and m.source_content_id=q.book_id
  where q.discovered_from='webfic_browse'
    and m.source_content_id is null
),
ins_d as (
  insert into public.dramas(
    id,slug,title,genre,mood,description,poster_url,
    featured,published,is_complete,is_r18
  )
  select
    c.drama_id,
    'dramabox-'||c.book_id,
    c.title,
    case
      when lower(c.tags::text) like '%romance%' then 'romance'
      when lower(c.tags::text) like '%fantasy%' then 'fantasy'
      when lower(c.tags::text) like '%action%' then 'action'
      when lower(c.tags::text) like '%comedy%' then 'comedy'
      when lower(c.tags::text) like '%thriller%' then 'thriller'
      when lower(c.tags::text) like '%mystery%' then 'mystery'
      when lower(c.tags::text) like '%revenge%' then 'revenge'
      when lower(c.tags::text) like '%family%' then 'family'
      when lower(c.tags::text) like '%werewolf%' then 'werewolf'
      when lower(c.tags::text) like '%billionaire%' then 'billionaire'
      when lower(c.tags::text) like '%mafia%' then 'mafia'
      when lower(c.tags::text) like '%crime%' then 'crime'
      else 'drama'
    end,
    '{}'::text[],
    c.description,
    c.cover_url,
    false,
    false,
    coalesce(c.metadata#>>'{browse,lastUpdateTimeDisplay}','') ilike '%complete%',
    false
  from candidates c
  on conflict (slug) do nothing
  returning id
),
ins_map as (
  insert into public.content_source_map(
    source_key,source_content_id,drama_id,source_url,metadata
  )
  select
    'dramafren_webfic',
    c.book_id,
    c.drama_id,
    c.canonical_url,
    jsonb_build_object('created_by','explicit_backfill','backfill_v','1')
  from candidates c
  join ins_d d on d.id=c.drama_id
  on conflict (source_key,source_content_id) do nothing
  returning source_content_id,drama_id
),
ins_rights as (
  insert into public.drama_rights(
    drama_id,rights_basis,verified,rights_notes
  )
  select
    c.drama_id,
    'unverified',
    false,
    'Created by explicit DramaBox/Webfic historical backfill. Publication remains blocked until rights are verified.'
  from candidates c
  join ins_d d on d.id=c.drama_id
  on conflict (drama_id) do nothing
  returning drama_id
)
update public.dramafren_catalog_queue q
set matched_drama_id=m.drama_id,
    matched_at=now(),
    updated_at=now()
from ins_map m
where q.book_id=m.source_content_id;

update public.dramafren_catalog_queue q
set matched_drama_id=m.drama_id,
    matched_at=coalesce(q.matched_at,now()),
    updated_at=now()
from public.content_source_map m
where m.source_key='dramafren_webfic'
  and m.source_content_id=q.book_id
  and q.matched_drama_id is distinct from m.drama_id;

update public.sync_queue
set status='completed',
    completed_at=now(),
    updated_at=now(),
    last_error=null,
    payload=payload || jsonb_build_object('bulk_backfill_completed',true)
where source_key='dramafren_webfic'
  and job_type='title_new'
  and payload->>'backfill'='true'
  and status='pending';


create table if not exists public.content_source_map (
  source_key text not null,
  source_content_id text not null,
  drama_id uuid not null references public.dramas(id) on delete cascade,
  source_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (source_key, source_content_id)
);

alter table public.content_source_map enable row level security;
revoke all on public.content_source_map from anon, authenticated;
grant select, insert, update, delete on public.content_source_map to service_role;

create index if not exists content_source_map_drama_idx
  on public.content_source_map(drama_id);

with dn as (
  select
    d.id,
    regexp_replace(lower(replace(replace(replace(coalesce(d.title,''),'’',''),'‘',''),'''','')),'[^a-z0-9]+','','g') as k
  from public.dramas d
),
unique_dn as (
  select k,min(id) as drama_id
  from dn
  where k<>''
  group by k
  having count(*)=1
),
qn as (
  select
    q.book_id,
    regexp_replace(lower(replace(replace(replace(coalesce(q.title,''),'’',''),'‘',''),'''','')),'[^a-z0-9]+','','g') as k
  from public.dramafren_catalog_queue q
  where q.matched_drama_id is null
)
update public.dramafren_catalog_queue q
set matched_drama_id=u.drama_id,
    matched_at=now(),
    updated_at=now()
from qn
join unique_dn u on u.k=qn.k
where q.book_id=qn.book_id;

insert into public.content_source_map(source_key,source_content_id,drama_id,source_url,metadata)
select
  'dramafren_webfic',
  q.book_id,
  q.matched_drama_id,
  q.canonical_url,
  jsonb_build_object('linked_from','normalized_title')
from public.dramafren_catalog_queue q
where q.matched_drama_id is not null
on conflict (source_key,source_content_id) do update
set drama_id=excluded.drama_id,
    source_url=excluded.source_url,
    last_seen_at=now(),
    metadata=public.content_source_map.metadata || excluded.metadata;

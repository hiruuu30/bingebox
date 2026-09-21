create table if not exists public.dramafren_v2_observations (
  id uuid primary key default gen_random_uuid(),
  book_id text,
  source_title text not null,
  source_url text,
  observation_kind text not null default 'recently_watched',
  match_status text not null default 'unresolved'
    check (match_status in ('matched','unresolved','new')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists dramafren_v2_observations_book_idx
  on public.dramafren_v2_observations(book_id)
  where book_id is not null;

create unique index if not exists dramafren_v2_observations_title_idx
  on public.dramafren_v2_observations(
    (regexp_replace(lower(source_title),'[^a-z0-9]+','','g'))
  );

alter table public.dramafren_v2_observations enable row level security;
revoke all on public.dramafren_v2_observations from anon,authenticated;
grant select,insert,update,delete on public.dramafren_v2_observations to service_role;

insert into public.source_sync_state(
  source_key,baseline_established_at,last_successful_scan_at,last_seen_source_id,
  last_seen_timestamp,sync_watermark,catalog_count,metadata,updated_at
)
values(
  'dramafren_v2',now(),null,'42000027417',now(),now(),12,
  jsonb_build_object(
    'source_url','https://dramaboxv2.dramafren.org/',
    'mode','secondary_discovery',
    'direct_backend_status',403,
    'cloudflare_blocked',true,
    'known_sample_matches',11,
    'known_sample_total',12,
    'note','Same DramaBox book-ID universe; dedupe into canonical dramafren_webfic records.'
  ),
  now()
)
on conflict(source_key) do update
set metadata=public.source_sync_state.metadata||excluded.metadata,
    catalog_count=excluded.catalog_count,
    last_seen_source_id=excluded.last_seen_source_id,
    updated_at=now();

with seed(book_id,title) as (
  values
  ('42000023929','Too Late for a Goddess'),
  ('42000021506','Mafia''s forbidden captive'),
  ('42000026093','Rebirth: Chasing My White Wolf Husband'),
  ('42000025240','Kneel Before The Dragon Queen'),
  ('42000027215','Conquer Wall Street With Magic'),
  ('42000025719','The Lion King in My Bed'),
  (null,'Pretending to Be the Mafia Boss''s Wife'),
  ('42000023710','I Tricked the Beast King Into Marriage'),
  ('42000027017','Supreme Raven: The Hidden Asgardian Boss'),
  ('42000026668','Taming the Enemy General'),
  ('42000021503','Dragon Secret Heart'),
  ('42000027264','Married Strangers')
)
insert into public.dramafren_v2_observations(
  book_id,source_title,source_url,observation_kind,match_status,metadata
)
select
  s.book_id,
  s.title,
  case when s.book_id is null then null
       else 'https://dramaboxv2.dramafren.org/index.php?id='||s.book_id||'&lang=en&page=detail'
  end,
  'recently_watched',
  case when s.book_id is null then 'unresolved' else 'matched' end,
  jsonb_build_object('seed','public_indexed_home_2026-09-21')
from seed s
on conflict do nothing;

insert into public.dramafren_v2_observations(
  book_id,source_title,source_url,observation_kind,match_status,metadata
)
values(
  '42000027417',
  'My Demon Lord, Your Shepherd Girl Has Run Away Again',
  'https://dramaboxv2.dramafren.org/index.php?id=42000027417&lang=en&page=detail&slug=my-demon-lord-your-shepherd-girl-has-run-away-again',
  'indexed_detail',
  'matched',
  jsonb_build_object('seed','public_indexed_detail_2026-09-21')
)
on conflict do nothing;

insert into public.content_source_map(
  source_key,source_content_id,drama_id,source_url,metadata
)
select
  'dramafren_v2',
  o.book_id,
  m.drama_id,
  o.source_url,
  jsonb_build_object('alias_of','dramafren_webfic','observation_kind',o.observation_kind)
from public.dramafren_v2_observations o
join public.content_source_map m
  on m.source_key='dramafren_webfic'
 and m.source_content_id=o.book_id
where o.book_id is not null
on conflict(source_key,source_content_id) do update
set drama_id=excluded.drama_id,
    source_url=excluded.source_url,
    last_seen_at=now(),
    metadata=public.content_source_map.metadata||excluded.metadata;

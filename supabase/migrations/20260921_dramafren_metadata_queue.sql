-- DramaFren / DramaBox metadata discovery queue.
-- Uses only the unsigned Webfic metadata endpoint; no protected chapter/video API.

create table if not exists public.dramafren_catalog_queue (
  book_id text primary key check (book_id ~ '^[0-9]{6,20}$'),
  canonical_url text not null,
  discovered_from text,
  status text not null default 'pending'
    check (status in ('pending','processing','ready','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  title text,
  cover_url text,
  description text,
  language text,
  chapter_count integer,
  shelf_time timestamptz,
  tags jsonb not null default '[]'::jsonb,
  recommendation_ids jsonb not null default '[]'::jsonb,
  metadata jsonb,
  last_error text,
  first_seen_at timestamptz not null default now(),
  last_fetched_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.dramafren_catalog_queue enable row level security;
revoke all on table public.dramafren_catalog_queue from anon, authenticated;
grant select, insert, update, delete on table public.dramafren_catalog_queue to service_role;

create index if not exists dramafren_catalog_queue_work_idx
  on public.dramafren_catalog_queue(status, next_attempt_at, first_seen_at)
  where status in ('pending','processing','failed');

create or replace function public.claim_dramafren_catalog_item(
  p_worker text,
  p_lease_seconds integer default 90
)
returns setof public.dramafren_catalog_queue
language plpgsql
security invoker
set search_path=public
as $$
begin
  if coalesce(trim(p_worker),'')='' then
    raise exception 'worker is required';
  end if;

  return query
  with candidate as (
    select q.book_id
    from public.dramafren_catalog_queue q
    where q.next_attempt_at <= now()
      and (
        q.status='pending'
        or q.status='failed'
        or (
          q.status='processing'
          and q.updated_at <= now() - make_interval(secs => greatest(30,least(coalesce(p_lease_seconds,90),300)))
        )
      )
    order by
      case q.status when 'pending' then 0 when 'failed' then 1 else 2 end,
      q.next_attempt_at asc,
      q.first_seen_at asc
    for update skip locked
    limit 1
  )
  update public.dramafren_catalog_queue q
  set status='processing',
      attempt_count=q.attempt_count+1,
      updated_at=now(),
      last_error=null
  from candidate c
  where q.book_id=c.book_id
  returning q.*;
end;
$$;

revoke all on function public.claim_dramafren_catalog_item(text,integer) from public,anon,authenticated;
grant execute on function public.claim_dramafren_catalog_item(text,integer) to service_role;

-- Fresh public DramaFren detail URLs observed in September 2026.
insert into public.dramafren_catalog_queue(book_id,canonical_url,discovered_from,status)
values
 ('42000027224','https://dramabox.dramafren.org/index.php?page=detail&id=42000027224&lang=en&slug=the-heirless-alpha-s-miracle-omega','dramafren_public_seed','pending'),
 ('42000027425','https://dramabox.dramafren.org/index.php?page=detail&id=42000027425&lang=en','dramafren_public_seed','pending'),
 ('42000026687','https://dramabox.dramafren.org/index.php?page=detail&id=42000026687&lang=en','dramafren_public_seed','pending'),
 ('42000024547','https://dramabox.dramafren.org/index.php?page=detail&id=42000024547&lang=en','dramafren_public_seed','pending')
on conflict (book_id) do nothing;

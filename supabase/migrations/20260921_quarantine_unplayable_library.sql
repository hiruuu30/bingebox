-- Reversible clean-live-library reset.
-- Keeps all rows and source metadata, but removes titles with no published R2-backed episode from the public catalog.

create table if not exists private.bingebox_library_quarantine_batches (
  batch_id uuid primary key,
  created_at timestamptz not null default now(),
  reason text not null,
  drama_count integer not null default 0,
  episode_count integer not null default 0
);

create table if not exists private.bingebox_library_quarantine_dramas (
  batch_id uuid not null references private.bingebox_library_quarantine_batches(batch_id) on delete cascade,
  drama_id uuid not null,
  slug text,
  title text,
  was_published boolean not null,
  was_featured boolean not null,
  publish_at timestamptz,
  quarantined_at timestamptz not null default now(),
  primary key (batch_id, drama_id)
);

create table if not exists private.bingebox_library_quarantine_episodes (
  batch_id uuid not null references private.bingebox_library_quarantine_batches(batch_id) on delete cascade,
  episode_id uuid not null,
  drama_id uuid not null,
  episode_number integer,
  was_published boolean not null,
  publish_at timestamptz,
  video_key text,
  video_url text,
  quarantined_at timestamptz not null default now(),
  primary key (batch_id, episode_id)
);

create index if not exists bingebox_quarantine_dramas_drama_idx
  on private.bingebox_library_quarantine_dramas(drama_id);
create index if not exists bingebox_quarantine_episodes_episode_idx
  on private.bingebox_library_quarantine_episodes(episode_id);
create index if not exists bingebox_quarantine_episodes_drama_idx
  on private.bingebox_library_quarantine_episodes(drama_id);

do $$
declare
  b uuid := gen_random_uuid();
  dc integer := 0;
  ec integer := 0;
begin
  insert into private.bingebox_library_quarantine_batches(batch_id, reason)
  values (
    b,
    '2026-09-21 clean-live-library reset: quarantine published dramas with no published R2-backed episode; preserve rows for recovery'
  );

  insert into private.bingebox_library_quarantine_dramas(
    batch_id, drama_id, slug, title, was_published, was_featured, publish_at
  )
  select b, d.id, d.slug, d.title, d.published, d.featured, d.publish_at
  from public.dramas d
  where d.published
    and not exists (
      select 1
      from public.episodes e
      where e.drama_id = d.id
        and e.published
        and coalesce(e.video_key,'') <> ''
    );

  get diagnostics dc = row_count;

  insert into private.bingebox_library_quarantine_episodes(
    batch_id, episode_id, drama_id, episode_number, was_published, publish_at, video_key, video_url
  )
  select b, e.id, e.drama_id, e.episode_number, e.published, e.publish_at, e.video_key, e.video_url
  from public.episodes e
  join private.bingebox_library_quarantine_dramas q
    on q.batch_id = b
   and q.drama_id = e.drama_id;

  get diagnostics ec = row_count;

  update public.episodes e
  set published = false,
      publish_at = null,
      updated_at = now()
  where exists (
    select 1
    from private.bingebox_library_quarantine_dramas q
    where q.batch_id = b
      and q.drama_id = e.drama_id
  )
    and (e.published or e.publish_at is not null);

  update public.dramas d
  set published = false,
      featured = false,
      publish_at = null,
      updated_at = now()
  where exists (
    select 1
    from private.bingebox_library_quarantine_dramas q
    where q.batch_id = b
      and q.drama_id = d.id
  );

  update private.bingebox_library_quarantine_batches
  set drama_count = dc,
      episode_count = ec
  where batch_id = b;
end
$$;

alter table public.dramafren_catalog_queue
  add column if not exists depth integer not null default 0
    check (depth between 0 and 3);

update public.dramafren_catalog_queue
set depth=0
where discovered_from='dramafren_public_seed';

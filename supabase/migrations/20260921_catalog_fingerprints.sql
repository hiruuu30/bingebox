alter table public.dramafren_catalog_queue
  add column if not exists metadata_fingerprint text,
  add column if not exists last_change_detected_at timestamptz;

create index if not exists dramafren_catalog_fingerprint_idx
  on public.dramafren_catalog_queue(metadata_fingerprint)
  where metadata_fingerprint is not null;

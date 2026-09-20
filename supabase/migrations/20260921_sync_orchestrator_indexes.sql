create index if not exists bingebox_sync_targets_last_job_id_idx
  on public.bingebox_sync_targets(last_job_id)
  where last_job_id is not null;

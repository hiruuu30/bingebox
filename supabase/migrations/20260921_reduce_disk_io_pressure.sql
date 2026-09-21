-- BingeBox low-I/O operating mode
-- Added after Supabase Disk IO Budget depletion warning.
-- Keeps automatic sync enabled while sharply reducing repetitive writes,
-- pg_net churn and queue-count scans.

create index if not exists sync_queue_provider_active_idx
on public.sync_queue (
  source_key,
  job_type,
  status,
  (coalesce(next_retry_at,created_at))
)
where status in ('pending','retry_wait','processing');

select cron.alter_job(5,  '*/30 * * * *', null, null, null, true);
select cron.alter_job(6,  '*/30 * * * *', null, null, null, true);
select cron.alter_job(7,  '*/5 * * * *',  null, null, null, true);
select cron.alter_job(9,  '7 */6 * * *',  null, null, null, true);
select cron.alter_job(10, '*/15 * * * *', null, null, null, true);
select cron.alter_job(12, '17 * * * * *', null, null, null, true);
select cron.alter_job(14, '*/5 * * * *',  null, null, null, true);
select cron.alter_job(15, '*/5 * * * *',  null, null, null, true);
select cron.alter_job(16, '37 */4 * * *', null, null, null, true);
select cron.alter_job(17, '43 */3 * * *', null, null, null, true);
select cron.alter_job(18, '*/5 * * * *',  null, null, null, true);
select cron.alter_job(19, '*/5 * * * *',  null, null, null, true);
select cron.alter_job(20, '*/5 * * * *',  null, null, null, true);
select cron.alter_job(21, '*/5 * * * *',  null, null, null, true);
select cron.alter_job(22, '*/5 * * * *',  null, null, null, true);
select cron.alter_job(23, '11 * * * *',   null, null, null, true);

select cron.alter_job(
  18,null,
  $cmd$
  do $gate$
  begin
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_flextv'
        and job_type='provider_resolve_episodes'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('episodes','dramafren_flextv');
    end if;
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_dramapops'
        and job_type='provider_resolve_episodes'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('episodes','dramafren_dramapops');
    end if;
  end
  $gate$;
  $cmd$,null,null,true
);

select cron.alter_job(
  19,null,
  $cmd$
  do $gate$
  begin
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_flextv'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_flextv')
      from generate_series(1,2);
    end if;
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_dramapops'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_dramapops');
    end if;
  end
  $gate$;
  $cmd$,null,null,true
);

select cron.alter_job(
  20,null,
  $cmd$
  do $gate$
  begin
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_netshort'
        and job_type='provider_resolve_episodes'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('episodes','dramafren_netshort');
    end if;
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_shortmax'
        and job_type='provider_resolve_episodes'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('episodes','dramafren_shortmax');
    end if;
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_goodshort'
        and job_type='provider_resolve_episodes'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('episodes','dramafren_goodshort');
    end if;
  end
  $gate$;
  $cmd$,null,null,true
);

select cron.alter_job(
  21,null,
  $cmd$
  do $gate$
  begin
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_reelshort'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_reelshort');
    end if;
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_flickreels'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_flickreels');
    end if;
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_netshort'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_netshort');
    end if;
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_shortmax'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_shortmax');
    end if;
  end
  $gate$;
  $cmd$,null,null,true
);

select cron.alter_job(
  22,null,
  $cmd$
  do $gate$
  begin
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_starshort'
        and job_type='provider_resolve_episodes'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('episodes','dramafren_starshort');
    end if;
    if exists (
      select 1 from public.sync_queue
      where source_key='dramafren_starshort'
        and job_type='provider_resolve_media'
        and status in ('pending','retry_wait')
        and coalesce(next_retry_at,created_at)<=now()
    ) then
      perform public.invoke_dramafren_provider_worker_for_source('media','dramafren_starshort');
    end if;
  end
  $gate$;
  $cmd$,null,null,true
);

alter function public.get_bingebox_analytics(integer)
  set work_mem = '16MB';

alter function public.get_bingebox_workspace_source_health()
  set work_mem = '16MB';

analyze public.sync_queue;
analyze public.dramafren_catalog_queue;
analyze public.episode_sources;

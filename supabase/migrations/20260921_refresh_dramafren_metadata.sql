alter table public.dramafren_catalog_queue
  add column if not exists matched_drama_id uuid references public.dramas(id) on delete set null,
  add column if not exists matched_at timestamptz;

create index if not exists dramafren_catalog_queue_matched_drama_idx
  on public.dramafren_catalog_queue(matched_drama_id)
  where matched_drama_id is not null;

update public.dramafren_catalog_queue
set next_attempt_at = now() + interval '12 hours'
where status='ready'
  and next_attempt_at <= now();

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
        q.status in ('pending','failed','ready')
        or (
          q.status='processing'
          and q.updated_at <= now() - make_interval(secs => greatest(30,least(coalesce(p_lease_seconds,90),300)))
        )
      )
    order by
      case q.status when 'pending' then 0 when 'failed' then 1 when 'processing' then 2 else 3 end,
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

do $$
declare j record;
begin
  select * into j from cron.job where jobname='bingebox-dramafren-metadata-sync';
  if found then
    perform cron.alter_job(
      j.jobid,
      command := $cmd$
      do $gate$
      begin
        if exists (
          select 1 from public.dramafren_catalog_queue
          where next_attempt_at <= now()
            and status in ('pending','failed','ready','processing')
        ) then
          perform net.http_post(
            url := 'https://shffgnuprnycqblpwkrp.supabase.co/functions/v1/dramafren-metadata-sync',
            headers := '{"Content-Type":"application/json"}'::jsonb,
            body := '{}'::jsonb,
            timeout_milliseconds := 20000
          );
        end if;
      end
      $gate$;
      $cmd$
    );
  end if;
end
$$;

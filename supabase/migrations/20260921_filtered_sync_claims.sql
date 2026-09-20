
create or replace function public.claim_sync_queue_job_filtered(
  p_worker uuid,
  p_job_types text[],
  p_lease_seconds integer default 120
)
returns setof public.sync_queue
language plpgsql
security invoker
set search_path=public
as $$
begin
  if p_worker is null then
    raise exception 'worker token is required';
  end if;
  if p_job_types is null or cardinality(p_job_types)=0 then
    raise exception 'job types are required';
  end if;

  return query
  with candidate as (
    select q.id
    from public.sync_queue q
    where q.job_type = any(p_job_types)
      and (
        q.status='pending'
        or (q.status='retry_wait' and coalesce(q.next_retry_at,'-infinity'::timestamptz)<=now())
        or (
          q.status='processing'
          and coalesce(q.lease_expires_at,q.heartbeat_at+interval '3 minutes','-infinity'::timestamptz)<=now()
        )
      )
    order by q.priority asc,q.created_at asc
    for update skip locked
    limit 1
  )
  update public.sync_queue q
  set status='processing',
      attempt_count=q.attempt_count+1,
      claimed_by=p_worker,
      claimed_at=now(),
      heartbeat_at=now(),
      lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,120),300))),
      updated_at=now()
  from candidate c
  where q.id=c.id
  returning q.*;
end;
$$;

revoke all on function public.claim_sync_queue_job_filtered(uuid,text[],integer) from public,anon,authenticated;
grant execute on function public.claim_sync_queue_job_filtered(uuid,text[],integer) to service_role;

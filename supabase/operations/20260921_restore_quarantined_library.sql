-- MANUAL ONLY: restore the most recent BingeBox clean-library quarantine batch.
-- Do not run until replacement media is reachable and verified.
do $$
declare
  b uuid;
begin
  select batch_id into b
  from private.bingebox_library_quarantine_batches
  order by created_at desc
  limit 1;

  if b is null then
    raise exception 'No BingeBox quarantine batch exists';
  end if;

  update public.episodes e
  set published = q.was_published,
      publish_at = q.publish_at,
      video_key = q.video_key,
      video_url = q.video_url,
      updated_at = now()
  from private.bingebox_library_quarantine_episodes q
  where q.batch_id = b
    and q.episode_id = e.id;

  update public.dramas d
  set published = q.was_published,
      featured = q.was_featured,
      publish_at = q.publish_at,
      updated_at = now()
  from private.bingebox_library_quarantine_dramas q
  where q.batch_id = b
    and q.drama_id = d.id;
end
$$;

-- BingeBox no longer gates publishing on distribution-rights records.
-- Legacy drama_rights rows are kept temporarily only so an older Workspace
-- deployment remains nonblocking until the rights-free Workspace reaches production.

drop trigger if exists trg_enforce_verified_rights_before_drama_publish on public.dramas;
drop trigger if exists trg_enforce_verified_rights_before_episode_publish on public.episodes;
drop function if exists public.enforce_verified_rights_before_drama_publish();
drop function if exists public.enforce_verified_rights_before_episode_publish();

create or replace function public.audit_strict_cloud_import_item()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_strict boolean := false;
  v_drama uuid;
  v_title text;
  v_mood_count int := 0;
  v_ep_count int := 0;
  v_min_ep int := 0;
  v_max_ep int := 0;
  v_good_ep_count int := 0;
  v_reason text := '';
  v_now timestamptz := now();
begin
  if new.status not in ('imported','partial') then return new; end if;
  select strict_mode into v_strict from public.cloud_import_jobs where id=new.job_id;
  if coalesce(v_strict,false) is not true then return new; end if;

  begin v_drama := nullif(new.metadata->>'drama_id','')::uuid;
  exception when others then v_drama := null; end;

  if v_drama is null then
    update public.cloud_import_items
       set status='rejected_strict',imported_episode_count=0,
           error='Strict rejection: importer did not provide a committed drama id.',updated_at=now()
     where id=new.id;
    update public.cloud_import_jobs set rejected_count=rejected_count+1 where id=new.job_id;
    return new;
  end if;

  select title,coalesce(array_length(mood,1),0)
    into v_title,v_mood_count
    from public.dramas where id=v_drama;

  select count(*),coalesce(min(episode_number),0),coalesce(max(episode_number),0)
    into v_ep_count,v_min_ep,v_max_ep
    from public.episodes where drama_id=v_drama;

  select count(distinct e.id)
    into v_good_ep_count
    from public.episodes e
   where e.drama_id=v_drama
     and exists (
       select 1 from public.episode_sources s
        where s.episode_id=e.id
          and s.active=true
          and s.source_type='direct'
          and s.origin_source_url is not null
          and (
            lower(split_part(split_part(s.origin_source_url,'://',2),'/',1))='dramaboxdb.com'
            or lower(split_part(split_part(s.origin_source_url,'://',2),'/',1)) like '%.dramaboxdb.com'
            or lower(split_part(split_part(s.origin_source_url,'://',2),'/',1))='netshort.com'
            or lower(split_part(split_part(s.origin_source_url,'://',2),'/',1)) like '%.netshort.com'
            or lower(split_part(split_part(s.origin_source_url,'://',2),'/',1))='wolftv.online'
            or lower(split_part(split_part(s.origin_source_url,'://',2),'/',1)) like '%.wolftv.online'
          )
          and not (
            s.origin_source_url ~ '[?&]auth_key=[0-9]{10}-'
            and substring(s.origin_source_url from '[?&]auth_key=([0-9]{10})-')::bigint
                <= extract(epoch from now())::bigint + 600
          )
     );

  if new.status='partial' then
    v_reason := 'Strict rejection: partial imports are not allowed.';
  elsif v_title is null or btrim(v_title)='' or lower(btrim(v_title)) in
        ('dramafren','home','watch now','latest','popular','all drama','all dramas','search','browse') then
    v_reason := 'Strict rejection: invalid or generic title.';
  elsif v_mood_count > 6 then
    v_reason := 'Strict rejection: mood metadata exceeded the strict six-tag limit.';
  elsif v_ep_count < 3 then
    v_reason := format('Strict rejection: only %s episodes were committed; minimum is 3.',v_ep_count);
  elsif v_min_ep <> 1 then
    v_reason := format('Strict rejection: episode sequence starts at %s instead of 1.',v_min_ep);
  elsif v_max_ep <> v_ep_count then
    v_reason := format('Strict rejection: episode numbering is not fully contiguous (count %s, max %s).',v_ep_count,v_max_ep);
  elsif new.episode_count <> v_ep_count then
    v_reason := format('Strict rejection: expected %s episodes but %s were committed.',new.episode_count,v_ep_count);
  elsif v_good_ep_count <> v_ep_count then
    v_reason := format('Strict rejection: only %s/%s episodes have a supported active reusable source.',v_good_ep_count,v_ep_count);
  end if;

  if v_reason <> '' then
    delete from public.episode_sources
     where episode_id in (select id from public.episodes where drama_id=v_drama);
    delete from public.episodes where drama_id=v_drama;
    delete from public.dramas where id=v_drama;
    update public.cloud_import_items
       set status='rejected_strict',imported_episode_count=0,error=v_reason,
           metadata=coalesce(metadata,'{}'::jsonb)||
                    jsonb_build_object('strict_rejected',true,'strict_reason',v_reason),
           updated_at=now()
     where id=new.id;
    update public.cloud_import_jobs set rejected_count=rejected_count+1 where id=new.job_id;
  else
    update public.episodes set published=true,publish_at=null,updated_at=v_now where drama_id=v_drama;
    update public.dramas set published=true,publish_at=null,updated_at=v_now where id=v_drama;
    update public.cloud_import_items
       set metadata=coalesce(metadata,'{}'::jsonb)||
                    jsonb_build_object('strict_published',true,'strict_published_at',v_now),
           error=null,updated_at=v_now
     where id=new.id;
  end if;
  return new;
end;
$$;

update public.episodes e
set published=true,publish_at=null,updated_at=now()
where e.published is not true
  and exists (
    select 1 from public.episode_sources s
     where s.episode_id=e.id and s.active=true
       and (
         (s.provider='legacy_r2' and nullif(e.video_key,'') is not null)
         or (
           s.provider='dramabox_web'
           and s.source_type='direct'
           and nullif(s.source_url,'') is not null
           and coalesce(s.health_status,'unknown') not in ('failed','expired')
           and (s.expires_at is null or s.expires_at>now())
         )
       )
  );

update public.dramas d
set published=true,publish_at=null,updated_at=now()
where d.published is not true
  and exists (select 1 from public.episodes e where e.drama_id=d.id and e.published=true);

-- Compatibility only; these rows no longer authorize anything.
insert into public.drama_rights(
  drama_id,rights_basis,verified,verified_at,verified_by,
  rights_holder,license_reference,territories,expires_on,rights_notes
)
select d.id,'other',true,now(),null,null,null,null,null,
       'Legacy compatibility record. Rights gating was removed from BingeBox on 2026-09-21.'
from public.dramas d
left join public.drama_rights r on r.drama_id=d.id
where r.drama_id is null
on conflict (drama_id) do nothing;

update public.drama_rights
set verified=true,
    verified_at=coalesce(verified_at,now()),
    expires_on=null,
    rights_basis=case when rights_basis='unverified' then 'other' else rights_basis end,
    rights_notes='Legacy compatibility record. Rights gating was removed from BingeBox on 2026-09-21.',
    updated_at=now();

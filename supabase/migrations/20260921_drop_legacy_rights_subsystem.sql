begin;

drop view if exists public.publication_audit_log;

alter table public.rights_audit_log rename to publication_audit_events;
alter sequence public.rights_audit_log_id_seq rename to publication_audit_events_id_seq;
alter table public.publication_audit_events
  rename constraint rights_audit_log_pkey to publication_audit_events_pkey;
alter table public.publication_audit_events
  rename constraint rights_audit_log_drama_id_fkey to publication_audit_events_drama_id_fkey;

drop policy if exists admins_read_rights_audit_log on public.publication_audit_events;
create policy admins_read_publication_audit_events
on public.publication_audit_events
for select
to authenticated
using (private.is_admin());

delete from public.publication_audit_events
where entity_type='drama_rights'
   or action like 'rights_%';

create or replace function private.write_publication_audit_log()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $$
declare
  v_action text;
  v_entity_id uuid;
  v_drama_id uuid;
  v_details jsonb;
begin
  if tg_table_name='dramas' then
    if tg_op<>'UPDATE' or new.published is not distinct from old.published then
      return new;
    end if;
    v_entity_id:=new.id;
    v_drama_id:=new.id;
    v_action:=case when new.published then 'drama_published' else 'drama_unpublished' end;
    v_details:=jsonb_build_object('title',new.title,'published',new.published);

  elsif tg_table_name='episodes' then
    if tg_op<>'UPDATE' or new.published is not distinct from old.published then
      return new;
    end if;
    v_entity_id:=new.id;
    v_drama_id:=new.drama_id;
    v_action:=case when new.published then 'episode_published' else 'episode_unpublished' end;
    v_details:=jsonb_build_object(
      'episode_number',new.episode_number,
      'title',new.title,
      'published',new.published
    );
  else
    return coalesce(new,old);
  end if;

  insert into public.publication_audit_events(
    actor_user_id,action,entity_type,entity_id,drama_id,details
  )
  values(
    auth.uid(),v_action,tg_table_name,v_entity_id,v_drama_id,coalesce(v_details,'{}'::jsonb)
  );

  return coalesce(new,old);
end;
$$;

drop trigger if exists trg_audit_drama_publish on public.dramas;
create trigger trg_audit_drama_publish
after update of published on public.dramas
for each row execute function private.write_publication_audit_log();

drop trigger if exists trg_audit_episode_publish on public.episodes;
create trigger trg_audit_episode_publish
after update of published on public.episodes
for each row execute function private.write_publication_audit_log();

drop table public.drama_rights;
drop function if exists public.touch_drama_rights();
drop function if exists private.write_rights_audit_log();

create view public.publication_audit_log
with (security_invoker=true)
as
select *
from public.publication_audit_events;

grant select on public.publication_audit_events to authenticated;
revoke all on public.publication_audit_events from anon;
grant select on public.publication_audit_log to authenticated;
revoke all on public.publication_audit_log from anon;

commit;

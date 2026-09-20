-- v23.5: allow public homepage to read only the safe hero highlight selection.
drop policy if exists "anon can read safe site settings" on public.site_settings;
create policy "anon can read safe site settings"
on public.site_settings for select
to anon
using (key = any (array['donate_url'::text,'donate_label'::text,'hero_highlight_ids'::text]));

drop policy if exists "authenticated can read site settings" on public.site_settings;
create policy "authenticated can read site settings"
on public.site_settings for select
to authenticated
using ((key = any (array['donate_url'::text,'donate_label'::text,'hero_highlight_ids'::text])) or private.is_admin());

-- Allow HLS sources and support provider HLS playback.
alter table public.episode_sources
  drop constraint if exists episode_sources_source_type_check;

alter table public.episode_sources
  add constraint episode_sources_source_type_check
  check (source_type = any(array['embed'::text,'direct'::text,'hls'::text]));

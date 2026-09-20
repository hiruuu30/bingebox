alter table public.dramas
  add column if not exists completion_push_sent_at timestamptz null;

comment on column public.dramas.completion_push_sent_at is
  'Timestamp when the automatic completed-drama publish push notification was successfully sent.';

-- Existing published complete titles were backfilled in production at rollout time
-- so the new automation does not retroactively notify subscribers about old releases.

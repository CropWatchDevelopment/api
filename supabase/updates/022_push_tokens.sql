-- 022_push_tokens.sql
-- FCM web-push device token registry.
--
-- One row per browser/device enrollment; a user accumulates one row per
-- enrolled device. The token is the primary key: FCM registration tokens are
-- globally unique, and re-registering the same token (page reload, token
-- refresh) is an idempotent upsert that re-stamps last_seen_at and, when a
-- different account logs in on the same browser, reassigns ownership
-- (last-writer-wins is correct — a token addresses one browser profile).
--
-- Rows are pruned by the alert service when FCM reports UNREGISTERED for a
-- token, and by the api when the user disables push on a device. Unlike
-- profiles.line_id this IS a token store — acceptable here because FCM
-- registration tokens only let the holder send push messages through our own
-- Firebase project, not act as the user (contrast 009_remove_discord.sql).
-- RLS is enabled with no policies: service-role (admin client) access only.

create table public.cw_push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index cw_push_tokens_user_id_idx on public.cw_push_tokens (user_id);

alter table public.cw_push_tokens enable row level security;

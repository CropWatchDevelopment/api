-- 017_line_notifications.sql
-- LINE Messaging API account linking (official account-link flow).
--
-- cw_line_link_nonces backs the nonce leg of LINE's account-link handshake:
-- the api mints a nonce when a logged-in user confirms linking, LINE echoes it
-- back in the accountLink webhook event, and the row is deleted on consume.
-- Rows are short-lived (10 minutes); createLinkNonce also purges expired rows
-- opportunistically, so no scheduled cleanup is needed.
--
-- Deliberately stores ONLY random nonces — never tokens of any kind
-- (see 009_remove_discord.sql for why per-user tokens are forbidden).
-- RLS is enabled with no policies: service-role (admin client) access only.

create table public.cw_line_link_nonces (
  nonce text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.cw_line_link_nonces enable row level security;

-- One CropWatch account per LINE account. profiles.line_id already exists;
-- this makes double-linking a 23505 the webhook handler turns into a
-- friendly "already linked to another user" DM.
create unique index profiles_line_id_key
  on public.profiles (line_id)
  where line_id is not null;

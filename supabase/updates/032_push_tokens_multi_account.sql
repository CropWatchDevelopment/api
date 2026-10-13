-- =============================================================================
-- 032_push_tokens_multi_account.sql
-- =============================================================================
-- One push subscription row per (browser token, account) instead of one per
-- browser token, so a shared browser (a farm-office PC) can carry alerts for
-- every account that turned push on there. Today the token is the primary
-- key: when a second account registers the same browser, the row moves to
-- them and the first person silently stops getting alerts on that device.
--
-- The new API upserts on (token, user_id). The current one upserts on token
-- alone, which needs a unique index on token alone, so the swap is split:
--
--  STEP 1 (below, run now): a unique index on (token, user_id). Token is
--     still unique, so the index always builds and both APIs keep working.
--  STEP 2 (commented out at the bottom): drop the token-only primary key and
--     promote the step-1 index to the primary key. From then on a browser can
--     hold several accounts. Run it only once the multi-device push API, the
--     alert service AND the app release are all live:
--       - the old API upserts on token alone, which then fails ("no unique or
--         exclusion constraint matching the ON CONFLICT"): enrollment breaks;
--       - the old alert service sends a shared browser one notification per
--         account;
--       - the old app re-registers the browser for whoever signs in on every
--         load, which would subscribe them without asking, and its "Disable"
--         deletes the browser's Firebase token, cutting off every other
--         account on that browser.
--     Until step 2 runs, a second account turning push on in a browser that
--     already has it gets an error; nobody's subscription is taken over.
--
-- Lookups by token alone (the alert service pruning a dead token, the API
-- moving rows when Firebase rotates a browser's token) use the new primary
-- key's leading column. cw_push_tokens_user_id_idx stays for per-user reads.
-- No column changes: database.types.ts is unaffected.
-- Rollback: bottom of file.
-- =============================================================================

-- STEP 1 ------------------------------------------------------------------------
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS cw_push_tokens_token_user_id_key
  ON public.cw_push_tokens (token, user_id);

COMMIT;

-- =============================================================================
-- STEP 2 — run separately, only after the new API, alert service and app are live
-- =============================================================================
-- BEGIN;
-- -- USING INDEX needs NOT NULL key columns; keep token NOT NULL explicitly
-- -- rather than relying on the old primary key's implied constraint.
-- ALTER TABLE public.cw_push_tokens ALTER COLUMN token SET NOT NULL;
-- ALTER TABLE public.cw_push_tokens DROP CONSTRAINT cw_push_tokens_pkey;
-- ALTER TABLE public.cw_push_tokens
--   ADD CONSTRAINT cw_push_tokens_pkey PRIMARY KEY USING INDEX cw_push_tokens_token_user_id_key;
-- COMMIT;

-- =============================================================================
-- OPS — verification (read-only)
-- =============================================================================
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.cw_push_tokens'::regclass AND contype = 'p';
-- -- after step 1: cw_push_tokens_pkey | PRIMARY KEY (token)
-- -- after step 2: cw_push_tokens_pkey | PRIMARY KEY (token, user_id)
-- SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'cw_push_tokens';
-- -- after step 1: cw_push_tokens_pkey, cw_push_tokens_user_id_idx, cw_push_tokens_token_user_id_key
-- -- after step 2: cw_push_tokens_pkey, cw_push_tokens_user_id_idx
-- -- Browsers carrying more than one account (only possible after step 2):
-- SELECT left(token, 12) AS token_prefix, count(*) AS accounts
--   FROM public.cw_push_tokens GROUP BY token HAVING count(*) > 1;

-- =============================================================================
-- ROLLBACK — the forward path in reverse
-- =============================================================================
-- 1. If step 2 ran: put the token-only primary key back, keeping the
--    (token, user_id) index so the old and the new API both keep working.
--    WARNING: a token-only key allows one account per browser, so this
--    deletes every account but the most recently seen one on each shared
--    browser; those people stop getting push alerts there until they turn
--    push on again. Check the "more than one account" query above first.
-- BEGIN;
-- DELETE FROM public.cw_push_tokens t
--  USING public.cw_push_tokens newer
--  WHERE newer.token = t.token
--    AND (newer.last_seen_at, newer.user_id) > (t.last_seen_at, t.user_id);
-- ALTER TABLE public.cw_push_tokens DROP CONSTRAINT cw_push_tokens_pkey;
-- ALTER TABLE public.cw_push_tokens ADD CONSTRAINT cw_push_tokens_pkey PRIMARY KEY (token);
-- CREATE UNIQUE INDEX cw_push_tokens_token_user_id_key
--   ON public.cw_push_tokens (token, user_id);
-- COMMIT;
-- 2. Roll back the app, then the API (the new app needs the new API; the old
--    app works with either).
-- 3. Only once the old API is back:
-- DROP INDEX IF EXISTS public.cw_push_tokens_token_user_id_key;

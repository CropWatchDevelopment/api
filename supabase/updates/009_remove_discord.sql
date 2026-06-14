-- =============================================================================
-- 009_remove_discord.sql
-- Remove the Discord integration from the database. CropWatch no longer uses
-- Discord notifications; the UI no longer offers Discord as a rule action or
-- report delivery method.
--
-- Verified before writing this script (2026-06-11):
--   * user_discord_connections: 1 row, exposes a Discord access_token —
--     this table was also the worst finding of the security review.
--   * communication_methods id 3 = 'Discord': referenced by ZERO rows in
--     report_recipients and cw_report_template_recipients.
--   * cw_notifier_types id 3 = 'discord': referenced by THREE legacy rows in
--     cw_rules (the legacy rules system, already removed from the API and
--     slated for the 008 drops) — those rows are reassigned to email first
--     so the FK delete succeeds.
--
-- Can run any time relative to 002–007. Idempotent: re-running is a no-op.
-- =============================================================================

BEGIN;

-- Legacy cw_rules rows still pointing at the discord notifier -> email.
UPDATE public.cw_rules
SET notifier_type = 1            -- email
WHERE notifier_type = 3;         -- discord

DELETE FROM public.cw_notifier_types WHERE notifier_id = 3;        -- 'discord'
DELETE FROM public.communication_methods WHERE communication_method_id = 3; -- 'Discord'

-- The connections table itself (held one row with a Discord access_token).
DROP TABLE IF EXISTS public.user_discord_connections;

COMMIT;

-- Post-check: no discord catalog rows, table gone.
SELECT 'cw_notifier_types' AS src, count(*) FROM public.cw_notifier_types WHERE name ILIKE '%discord%'
UNION ALL
SELECT 'communication_methods', count(*) FROM public.communication_methods WHERE name ILIKE '%discord%';
SELECT to_regclass('public.user_discord_connections') AS should_be_null;
-- (expected: counts 0 and 0; should_be_null = NULL)

-- MANUAL FOLLOW-UP: revoke the CropWatch application/bot in the Discord
-- developer portal so the stored access token (now deleted) is dead anyway.

-- =============================================================================
-- 006_remove_stripe.sql
-- Remove the Stripe integration from the database entirely. CropWatch no
-- longer uses Stripe: the API payments module and the web app billing pages
-- have been deleted, so nothing reads these objects anymore.
--
-- This supersedes the earlier plan to merely move the foreign tables out of
-- the PostgREST-exposed schema — they are dropped instead. Foreign tables
-- hold NO local data (they proxy live Stripe API calls), so dropping them
-- deletes nothing on the Stripe side.
--
-- Verified before writing this script (2026-06-11):
--   * Foreign tables: public.stripe_products, public.stripe_customers,
--     public.stripe_subscriptions (the security advisor flagged them as
--     API-exposed and exempt from RLS).
--   * Foreign server: stripe_server (FDW "stripe", provided by the Supabase
--     "wrappers" extension v0.5.3).
--   * stripe_server is the ONLY foreign server in the database, so the
--     wrappers extension has no other dependents.
--
-- Idempotent: IF EXISTS everywhere; the DO block tolerates already-removed
-- objects.
-- =============================================================================

BEGIN;

-- Foreign tables (check both schemas in case 006's earlier version ran).
DROP FOREIGN TABLE IF EXISTS public.stripe_products;
DROP FOREIGN TABLE IF EXISTS public.stripe_customers;
DROP FOREIGN TABLE IF EXISTS public.stripe_subscriptions;
DROP FOREIGN TABLE IF EXISTS stripe.stripe_products;
DROP FOREIGN TABLE IF EXISTS stripe.stripe_customers;
DROP FOREIGN TABLE IF EXISTS stripe.stripe_subscriptions;
DROP SCHEMA IF EXISTS stripe;

-- Foreign server + any leftover objects that depend on it.
DROP SERVER IF EXISTS stripe_server CASCADE;

-- The wrappers extension only existed for the Stripe FDW; remove it now that
-- no foreign server remains. (Re-installable any time from the dashboard.)
DROP EXTENSION IF EXISTS wrappers;

COMMIT;

-- Post-check: no foreign tables, servers, or wrappers extension left.
SELECT foreign_table_schema, foreign_table_name FROM information_schema.foreign_tables;
SELECT srvname FROM pg_foreign_server;
SELECT extname FROM pg_extension WHERE extname = 'wrappers';
-- (expected: zero rows from all three)

-- MANUAL FOLLOW-UPS:
--   * Supabase Vault stores the Stripe API key the wrapper used. List and
--     delete it (Dashboard -> Vault, or):
--       SELECT id, name, description FROM vault.secrets;
--       -- then: DELETE FROM vault.secrets WHERE name = '<the stripe key>';
--   * Revoke/delete the restricted API key in the Stripe dashboard itself.
--   * Remove any PRIVATE_STRIPE_* / payments env vars from API deployments.

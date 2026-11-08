-- =============================================================================
-- 037_ai_recommendations.sql
-- Storage and scoped database roles for the CropWatch AI growth recommender
-- (repo cw-ai-services, runs on a dedicated Jetson Orin NX on the office LAN).
--
-- Producer: the Jetson worker. Once per local day (and once per ISO week) it
-- reads one soil device's cw_soil_data, scores it against cw_crop_targets (or a
-- per-device override), phrases the result with a local Qwen model, and upserts
-- one row into cw_ai_recommendations.
-- Consumer: later, the Nest API (service role, existing device-permission
-- checks) for a recommendation card in the CropWatch app. No UI reads it yet.
--
-- Design notes:
--  * Daily and weekly reports share one table, keyed (dev_eui, report_type,
--    period_start). Re-running a period replaces its row (ON CONFLICT DO
--    UPDATE), so retries and rules changes never stack duplicates.
--  * dev_eui has a real FK to cw_devices (ON UPDATE CASCADE like
--    cw_devices.location_id; ON DELETE CASCADE so delete_device() leaves no
--    orphans).
--  * cw_device_target_overrides holds per-device bands that win over the crop's
--    targets. The recommender judges soil moisture and bulk EC ONLY when an
--    override exists: the crop targets assume loam (moisture) or have no
--    bulk-probe band at all (EC), so judging without one would give wrong advice.
--  * status / report_type are text + CHECK (the DB has no enums; 016 convention).
--  * Two LOGIN roles instead of the service-role key, so a bug or a stolen
--    Jetson cannot touch anything else:
--      cw_ai_reader  read-only, column-level SELECT on the inputs only
--                    (no names, owners, org ids or serials);
--      cw_ai_writer  SELECT/INSERT/UPDATE on cw_ai_recommendations only;
--                    cannot read telemetry. FK checks run as the table owner,
--                    so it needs nothing on cw_devices.
--    Every public table has RLS on and no policies (002/003), so each role also
--    gets policies scoped TO that role only; anon/authenticated still see nothing.
--  * Roles are created WITHOUT passwords. Set them by hand afterwards (OPS
--    below); passwords never go in git. Connect through the Supavisor session
--    pooler as <role>.<project_ref>.
--
-- Run order: any time. Additive, no data rewrite. CREATE POLICY needs a brief
-- lock on cw_soil_data; lock_timeout makes it give up after 5 s instead of
-- queueing behind a long read (if it times out, nothing changed; run again).
-- Afterwards regenerate database.types.ts (api + CropWatch).
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cw_ai_recommendations (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dev_eui            varchar NOT NULL
                       REFERENCES public.cw_devices (dev_eui) ON UPDATE CASCADE ON DELETE CASCADE,
    report_type        text NOT NULL CHECK (report_type IN ('daily', 'weekly')),
    period_start       date NOT NULL,
    period_end         date NOT NULL,
    timezone           text NOT NULL DEFAULT 'Asia/Tokyo',
    crop_type_id       bigint REFERENCES public.cw_crop_types (id) ON DELETE SET NULL,
    status             text NOT NULL CHECK (status IN ('good', 'action', 'insufficient_data')),
    max_severity       smallint NOT NULL DEFAULT 0 CHECK (max_severity BETWEEN 0 AND 3),
    metrics            jsonb NOT NULL,
    findings           jsonb NOT NULL DEFAULT '[]'::jsonb,
    details            jsonb NOT NULL DEFAULT '[]'::jsonb,
    headline_ja        text NOT NULL,
    body_ja            text NOT NULL,
    headline_en        text NOT NULL,
    body_en            text NOT NULL,
    text_source        text NOT NULL CHECK (text_source IN ('llm', 'template')),
    llm_attempts       smallint NOT NULL DEFAULT 0 CHECK (llm_attempts >= 0),
    model              text,
    prompt_version     text,
    rules_version      text NOT NULL,
    targets_updated_at timestamptz,
    generation_ms      integer CHECK (generation_ms >= 0),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cw_ai_recommendations_period_key UNIQUE (dev_eui, report_type, period_start),
    CONSTRAINT cw_ai_recommendations_period_order CHECK (period_end >= period_start),
    CONSTRAINT cw_ai_recommendations_period_length CHECK (
        (report_type = 'daily'  AND period_end = period_start) OR
        (report_type = 'weekly' AND period_end = period_start + 6)
    )
);

CREATE INDEX IF NOT EXISTS cw_ai_recommendations_dev_type_start_idx
    ON public.cw_ai_recommendations (dev_eui, report_type, period_start DESC);

COMMENT ON TABLE public.cw_ai_recommendations IS
    'AI growth recommendations, one row per (dev_eui, report_type, period_start). Written by the cw-ai-services Jetson worker (role cw_ai_writer); every number and action comes from its rules engine, the LLM only phrases them (037).';
COMMENT ON COLUMN public.cw_ai_recommendations.metrics IS
    'Per metric x period (day/night/all): stats, coverage, effective target band and its source (crop/override), severity 0-3, judged flag and reason when not judged.';
COMMENT ON COLUMN public.cw_ai_recommendations.findings IS
    'Severity>=2 items in display order: metric, period, value, target, action key, action_params (e.g. computed RH after heating).';
COMMENT ON COLUMN public.cw_ai_recommendations.details IS
    'Deterministic "what this value means" text per metric: [{metric, period, ja, en}]. Never LLM-generated.';
COMMENT ON COLUMN public.cw_ai_recommendations.rules_version IS
    'cw-ai-services version (git hash) that produced the row, so a threshold or logic change is visible in history.';
COMMENT ON COLUMN public.cw_ai_recommendations.targets_updated_at IS
    'max(updated_at) of the target rows used, so a result can be tied to the target table as it was.';

ALTER TABLE public.cw_ai_recommendations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cw_device_target_overrides (
    dev_eui     varchar NOT NULL
                REFERENCES public.cw_devices (dev_eui) ON UPDATE CASCADE ON DELETE CASCADE,
    metric      text NOT NULL CHECK (metric IN (
                    'soil_temperature', 'soil_water_tension', 'soil_moisture', 'soil_ec',
                    'soil_ec_1to5', 'soil_ph', 'air_temperature', 'air_humidity', 'co2',
                    'ppfd', 'dli', 'vpd')),
    period      text NOT NULL DEFAULT 'all' CHECK (period IN ('all', 'day', 'night')),
    min_value   numeric,
    optimal_min numeric,
    optimal_max numeric,
    max_value   numeric,
    reason      text,
    set_by      uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dev_eui, metric, period),
    -- Same band rule as cw_crop_targets_band_order.
    CONSTRAINT cw_device_target_overrides_band_order CHECK (
        (min_value IS NULL OR optimal_min IS NULL OR min_value <= optimal_min) AND
        (optimal_min IS NULL OR optimal_max IS NULL OR optimal_min <= optimal_max) AND
        (optimal_max IS NULL OR max_value IS NULL OR optimal_max <= max_value) AND
        (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
    ),
    CONSTRAINT cw_device_target_overrides_has_band CHECK (
        optimal_min IS NOT NULL OR optimal_max IS NOT NULL
    )
);

COMMENT ON TABLE public.cw_device_target_overrides IS
    'Per-device target bands that override cw_crop_targets for the same metric/period (units as in cw_crop_targets). The AI recommender judges soil_moisture and soil_ec only when a row exists here (037).';

ALTER TABLE public.cw_device_target_overrides ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Roles (no passwords here; see OPS)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cw_ai_reader') THEN
        CREATE ROLE cw_ai_reader LOGIN NOINHERIT CONNECTION LIMIT 4;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cw_ai_writer') THEN
        CREATE ROLE cw_ai_writer LOGIN NOINHERIT CONNECTION LIMIT 2;
    END IF;
END
$$;

ALTER ROLE cw_ai_reader SET default_transaction_read_only = on;
ALTER ROLE cw_ai_reader SET statement_timeout = '30s';
ALTER ROLE cw_ai_reader SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE cw_ai_writer SET statement_timeout = '15s';
ALTER ROLE cw_ai_writer SET idle_in_transaction_session_timeout = '60s';

GRANT USAGE ON SCHEMA public TO cw_ai_reader, cw_ai_writer;

-- Reader: inputs only, column by column.
GRANT SELECT (dev_eui, created_at, temperature_c, moisture, ec, ph,
              air_temperature_c, air_humidity, ppfd, co2)
    ON public.cw_soil_data TO cw_ai_reader;
GRANT SELECT (dev_eui, type, crop_type_id, location_id, lat, long)
    ON public.cw_devices TO cw_ai_reader;
GRANT SELECT (id, data_table_v2) ON public.cw_device_type TO cw_ai_reader;
GRANT SELECT (location_id, lat, long, network_region) ON public.cw_locations TO cw_ai_reader;
GRANT SELECT ON public.cw_crop_types, public.cw_crop_targets,
                public.cw_device_target_overrides TO cw_ai_reader;

-- Writer: the report table only. Identity columns need no sequence grant.
GRANT SELECT, INSERT, UPDATE ON public.cw_ai_recommendations TO cw_ai_writer;

-- Policies scoped to these roles only (anon/authenticated remain without access).
DROP POLICY IF EXISTS cw_ai_reader_select ON public.cw_soil_data;
CREATE POLICY cw_ai_reader_select ON public.cw_soil_data FOR SELECT TO cw_ai_reader USING (true);
DROP POLICY IF EXISTS cw_ai_reader_select ON public.cw_devices;
CREATE POLICY cw_ai_reader_select ON public.cw_devices FOR SELECT TO cw_ai_reader USING (true);
DROP POLICY IF EXISTS cw_ai_reader_select ON public.cw_device_type;
CREATE POLICY cw_ai_reader_select ON public.cw_device_type FOR SELECT TO cw_ai_reader USING (true);
DROP POLICY IF EXISTS cw_ai_reader_select ON public.cw_locations;
CREATE POLICY cw_ai_reader_select ON public.cw_locations FOR SELECT TO cw_ai_reader USING (true);
DROP POLICY IF EXISTS cw_ai_reader_select ON public.cw_crop_types;
CREATE POLICY cw_ai_reader_select ON public.cw_crop_types FOR SELECT TO cw_ai_reader USING (true);
DROP POLICY IF EXISTS cw_ai_reader_select ON public.cw_crop_targets;
CREATE POLICY cw_ai_reader_select ON public.cw_crop_targets FOR SELECT TO cw_ai_reader USING (true);
DROP POLICY IF EXISTS cw_ai_reader_select ON public.cw_device_target_overrides;
CREATE POLICY cw_ai_reader_select ON public.cw_device_target_overrides FOR SELECT TO cw_ai_reader USING (true);

DROP POLICY IF EXISTS cw_ai_writer_select ON public.cw_ai_recommendations;
CREATE POLICY cw_ai_writer_select ON public.cw_ai_recommendations FOR SELECT TO cw_ai_writer USING (true);
DROP POLICY IF EXISTS cw_ai_writer_insert ON public.cw_ai_recommendations;
CREATE POLICY cw_ai_writer_insert ON public.cw_ai_recommendations FOR INSERT TO cw_ai_writer WITH CHECK (true);
DROP POLICY IF EXISTS cw_ai_writer_update ON public.cw_ai_recommendations;
CREATE POLICY cw_ai_writer_update ON public.cw_ai_recommendations FOR UPDATE TO cw_ai_writer USING (true) WITH CHECK (true);

-- Make the API (PostgREST) see the new tables right away (sent at COMMIT).
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- OPS (by hand, after COMMIT)
-- ---------------------------------------------------------------------------
-- 1. Set the role passwords in psql (prompts; nothing lands in history):
--      \password cw_ai_reader
--      \password cw_ai_writer
--    Or from the SQL editor, without the plain text reaching Supabase:
--    `python3 deploy/role_passwords.py` in cw-ai-services prints random
--    passwords plus ALTER ROLE statements carrying only their SCRAM hashes.
--    Put them only in /etc/cw-ai/env on the Jetson (root:cwai 0640).
--
-- 2. Device 11's soil-moisture band, once the grower agrees one (example values;
--    its volcanic-ash soil sits near 47 % VWC, far from the loam crop band):
--      INSERT INTO public.cw_device_target_overrides
--             (dev_eui, metric, period, min_value, optimal_min, optimal_max, max_value, reason)
--      VALUES ('343634316633780C', 'soil_moisture', 'all', NULL, 42, 52, NULL,
--              'Grower-agreed band for this house''s volcanic-ash soil');

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- Roles and settings:
--   SELECT rolname, rolcanlogin, rolbypassrls, rolconnlimit, rolconfig
--     FROM pg_roles WHERE rolname IN ('cw_ai_reader', 'cw_ai_writer');
-- Policies (expect 7 reader + 3 writer rows):
--   SELECT tablename, policyname, roles, cmd FROM pg_policies
--    WHERE policyname LIKE 'cw_ai_%' ORDER BY tablename, policyname;
-- Least privilege, as each role (psql "...user=cw_ai_reader.<ref>..."):
--   reader: SELECT count(*) FROM cw_soil_data WHERE dev_eui = '343634316633780C'
--           AND created_at > now() - interval '1 day';               -- works
--   reader: SELECT name FROM cw_devices LIMIT 1;                     -- permission denied
--   reader: INSERT INTO cw_device_target_overrides (dev_eui, metric, optimal_min)
--           VALUES ('343634316633780C', 'soil_moisture', 1);           -- read-only transaction
--   writer: SELECT 1 FROM cw_soil_data LIMIT 1;                      -- permission denied
--   writer: DELETE FROM cw_ai_recommendations;                       -- permission denied

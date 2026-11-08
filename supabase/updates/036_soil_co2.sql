-- 036_soil_co2.sql
-- cw_soil_data.co2 for the cw-divergent soil board (CW-SS-TME on the Rev 9C
-- board: soil probe + SCD41 CO2 + AS7341 light). Its CO2 frame (fPort 3) also
-- carries air temperature / humidity, which go to the existing
-- air_temperature_c / air_humidity columns; its light frame (fPort 4) goes to
-- the existing ppfd column. Same type as cw_air_data.co2.
--
-- Run BEFORE deploying the Data-Ingress soil writer that writes co2
-- (cw-data-handler-ts LavinMQ-to-Postgres soilDataWriter.ts): until then its
-- upserts for these devices fail on the unknown column and retry. Legacy soil
-- devices never send co2 and are unaffected either way.
--
-- Additive, nullable, no default: a catalog-only change, no table rewrite.
-- It still needs a brief exclusive lock on cw_soil_data. lock_timeout makes it
-- give up after 5 s instead of queueing behind a long-running read, which
-- would hold up every soil write and read in the meantime; if it times out,
-- nothing changed, just run it again.

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cw_soil_data
    ADD COLUMN IF NOT EXISTS co2 double precision;

COMMENT ON COLUMN public.cw_soil_data.co2 IS
    'Air CO2 (ppm) from soil boards with an SCD41; NULL for probes without one.';

-- Make the API (PostgREST) see the new column right away (sent at COMMIT).
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'cw_soil_data' ORDER BY ordinal_position;

-- ---------------------------------------------------------------------------
-- OPS (optional, run by hand once Data-Ingress owns cw-jp-ss and the FlowFuse
-- JP flow no longer writes it): delete the empty rows the per-frame FlowFuse
-- path left for the cw-divergent board — one per CO2 / light frame, with no
-- value in any column. Preview with the SELECT first.
-- ---------------------------------------------------------------------------
-- SELECT count(*) FROM public.cw_soil_data
--  WHERE dev_eui = '343634316633780C'
--    AND temperature_c IS NULL AND moisture IS NULL AND ec IS NULL AND ph IS NULL
--    AND air_temperature_c IS NULL AND air_humidity IS NULL AND ppfd IS NULL AND co2 IS NULL;
--
-- DELETE FROM public.cw_soil_data
--  WHERE dev_eui = '343634316633780C'
--    AND temperature_c IS NULL AND moisture IS NULL AND ec IS NULL AND ph IS NULL
--    AND air_temperature_c IS NULL AND air_humidity IS NULL AND ppfd IS NULL AND co2 IS NULL;

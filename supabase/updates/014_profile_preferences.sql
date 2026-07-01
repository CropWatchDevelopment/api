-- =============================================================================
-- 014_profile_preferences.sql
-- User display/measurement preferences + auth email -> profiles.email sync.
--
--  A) profile_preferences — a 1-to-1 companion to `profiles` holding per-user
--     display choices (theme, unit systems, home timezone). Kept in its own
--     table (not columns on `profiles`) so it does not widen the `profiles`
--     selects that are joined into device/location reads everywhere, mirroring
--     the rationale for billing_customers in 010_polar_device_licenses.sql.
--
--     Constrained columns use text + CHECK (the DB has no enums; this matches
--     the device_licenses.status style). All preference columns are nullable —
--     the API get-or-create seeds an empty row and the client falls back to
--     defaults for any null.
--
--  B) sync_profile_email() trigger — the verified email-change flow updates
--     auth.users.email once the user confirms. `profiles.email` is a
--     denormalized mirror that is only populated on INSERT by handle_new_user();
--     this AFTER UPDATE trigger keeps it in step on subsequent email changes.
--
-- RLS is enabled with no anon/authenticated policies, matching the posture of
-- 002_enable_rls_all_public.sql: the API uses the service-role client and
-- enforces authorization in Nest.
--
-- Idempotent: CREATE ... IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.
-- Regenerate database.types.ts (api + CropWatch) after running.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A) profile_preferences — 1-to-1 with profiles(id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_preferences (
  user_id            uuid        PRIMARY KEY
                                 REFERENCES public.profiles (id) ON DELETE CASCADE,
  theme              text        CHECK (theme IN ('light', 'dark', 'system')),
  temperature_unit   text        CHECK (temperature_unit IN ('celsius', 'fahrenheit', 'kelvin')),
  weight_unit        text        CHECK (weight_unit IN ('kg', 'lb')),
  ec_unit            text        CHECK (ec_unit IN ('ms_cm', 'ds_cm', 'us_cm')),
  water_level_unit   text        CHECK (water_level_unit IN ('cm', 'mm', 'inch', 'foot', 'meter', 'yard')),
  timezone           text,       -- IANA zone name, e.g. 'Asia/Tokyo'
  distance_unit      text        CHECK (distance_unit IN ('km', 'mi')),
  area_unit          text        CHECK (area_unit IN ('hectares', 'acres', 'square_meters')),
  soil_moisture_unit text        CHECK (soil_moisture_unit IN ('vwc_percent', 'relative_percent', 'kpa', 'centibar')),
  pressure_unit      text        CHECK (pressure_unit IN ('hpa', 'kpa', 'bar', 'psi')),
  rainfall_unit      text        CHECK (rainfall_unit IN ('mm', 'cm', 'in')),
  wind_speed_unit    text        CHECK (wind_speed_unit IN ('m_s', 'km_h', 'mph', 'kt')),
  co2_unit           text        CHECK (co2_unit IN ('ppm', 'mg_m3')),
  date_format        text        CHECK (date_format IN ('yyyy_mm_dd', 'dd_mm_yyyy', 'mm_dd_yyyy')),
  time_format        text        CHECK (time_format IN ('24h', '12h')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Additive: brings a table created by an earlier revision of this script (only the
-- theme/temperature/weight/ec/water-level/timezone columns) up to the full set.
-- No-ops on a fresh CREATE above.
ALTER TABLE public.profile_preferences
  ADD COLUMN IF NOT EXISTS distance_unit      text CHECK (distance_unit IN ('km', 'mi')),
  ADD COLUMN IF NOT EXISTS area_unit          text CHECK (area_unit IN ('hectares', 'acres', 'square_meters')),
  ADD COLUMN IF NOT EXISTS soil_moisture_unit text CHECK (soil_moisture_unit IN ('vwc_percent', 'relative_percent', 'kpa', 'centibar')),
  ADD COLUMN IF NOT EXISTS pressure_unit      text CHECK (pressure_unit IN ('hpa', 'kpa', 'bar', 'psi')),
  ADD COLUMN IF NOT EXISTS rainfall_unit      text CHECK (rainfall_unit IN ('mm', 'cm', 'in')),
  ADD COLUMN IF NOT EXISTS wind_speed_unit    text CHECK (wind_speed_unit IN ('m_s', 'km_h', 'mph', 'kt')),
  ADD COLUMN IF NOT EXISTS co2_unit           text CHECK (co2_unit IN ('ppm', 'mg_m3')),
  ADD COLUMN IF NOT EXISTS date_format        text CHECK (date_format IN ('yyyy_mm_dd', 'dd_mm_yyyy', 'mm_dd_yyyy')),
  ADD COLUMN IF NOT EXISTS time_format        text CHECK (time_format IN ('24h', '12h'));

ALTER TABLE public.profile_preferences ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- B) Keep profiles.email in sync with auth.users.email after a verified change
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET email = NEW.email
   WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.sync_profile_email();

COMMIT;

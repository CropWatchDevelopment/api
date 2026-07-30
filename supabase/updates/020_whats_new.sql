-- =============================================================================
-- 020_whats_new.sql
-- "What's New" announcement flag + per-user seen tracking.
--
--  A) whats_new — a single-row flag table (key = 'app') holding the currently
--     published announcement release number. The release-note CONTENT ships
--     inside the CropWatch app (i18n keys) together with a matching content
--     release constant; this row only decides when the dialog activates.
--     Publishing = manual UPDATE (see OPS footer), run AFTER the app deploy
--     that contains the matching content. The app shows the dialog only when
--     its content release equals current_release, so a stale deployment (or a
--     premature bump) stays silent instead of showing mismatched notes.
--
--  B) profile_whats_new_seen — one row per user (upserted, NOT append-only):
--     the release the user last dismissed. The dialog shows once when
--     current_release > seen release, and dismissing records it permanently.
--     Kept off `profiles` (014 rationale) and off `profile_preferences`
--     (that table is display/measurement preferences; this is app state).
--
--  C) handle_new_user() — full 019 body plus a pre-seed marking brand-new
--     users as having seen the current release: a fresh signup should not get
--     a "what's new" dialog when the whole app is new to them.
--     Run order: 019 before 020 (this REPLACE includes 019's changes).
--
-- RLS is enabled with no anon/authenticated policies, matching the posture of
-- 002_enable_rls_all_public.sql: the API uses the service-role client and
-- enforces authorization in Nest.
--
-- Idempotent: CREATE ... IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT.
-- Regenerate database.types.ts (api + CropWatch) after running.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A) whats_new — single-row announcement flag
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whats_new (
  key             text        PRIMARY KEY CHECK (key = 'app'),
  current_release integer     NOT NULL DEFAULT 0 CHECK (current_release >= 0),
  published_at    timestamptz
);

ALTER TABLE public.whats_new ENABLE ROW LEVEL SECURITY;

-- Release 0 = nothing to announce; the first OPS bump activates the dialog.
INSERT INTO public.whats_new (key, current_release, published_at)
VALUES ('app', 0, NULL)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- B) profile_whats_new_seen — one row per user, upserted on dismiss
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_whats_new_seen (
  user_id uuid        PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  release integer     NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_whats_new_seen ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- C) handle_new_user() — 019 body + what's-new seen pre-seed for new signups
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (
    id, username, full_name, employer, avatar_url, email, created_at
  )
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'username',
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NULLIF(TRIM(CONCAT_WS(' ',
        NEW.raw_user_meta_data->>'first_name',
        NEW.raw_user_meta_data->>'last_name')), '')
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'employer',
      NEW.raw_user_meta_data->>'company'
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    COALESCE(NEW.raw_user_meta_data->>'email', NEW.email),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.profiles.email);

  INSERT INTO public.profile_legal_acceptances (user_id, kind, version)
  SELECT NEW.id, ld.kind, ld.current_version
  FROM public.legal_documents ld
  WHERE (ld.kind = 'privacy_policy'   AND NEW.raw_user_meta_data->>'agreed_privacy' = 'true')
     OR (ld.kind = 'terms_of_service' AND NEW.raw_user_meta_data->>'agreed_terms'   = 'true')
     OR (ld.kind = 'eula'             AND NEW.raw_user_meta_data->>'agreed_eula'    = 'true')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.profile_whats_new_seen (user_id, release)
  SELECT NEW.id, wn.current_release
  FROM public.whats_new wn
  WHERE wn.key = 'app'
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

COMMIT;

-- =============================================================================
-- OPS: publishing a "What's New" announcement
--
-- 1. Ship the app deploy whose release notes (i18n keys) and
--    WHATS_NEW_CONTENT_RELEASE constant describe release <N>.
-- 2. Then activate it; every user sees the dialog once on their next visit:
--
--   UPDATE public.whats_new
--      SET current_release = <N>,
--          published_at    = now()
--    WHERE key = 'app';
-- =============================================================================

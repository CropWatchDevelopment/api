-- =============================================================================
-- 019_legal_documents.sql
-- Versioned legal documents + per-user acceptance audit for the "re-accept
-- updated ToS/EULA/Privacy Policy" gate.
--
--  A) legal_documents — one row per document kind with the currently published
--     version. Publishing an updated document is a manual UPDATE bumping
--     current_version (see the OPS footer); no deploy is needed — the app
--     gates every user whose latest acceptance is below current_version.
--
--  B) profile_legal_acceptances — append-only audit of which user accepted
--     which version of which document, and when. Kept in its own table (not
--     columns on `profiles`) so it does not widen the `profiles` selects that
--     are joined into device/location reads everywhere, mirroring the
--     rationale in 014_profile_preferences.sql. profiles.accepted_agreements
--     (a bare boolean, never read or written by any code) is superseded and
--     marked deprecated.
--
--  C) handle_new_user() — extended so the consent the user gives at signup
--     (agreed_privacy / agreed_terms / agreed_eula in raw_user_meta_data,
--     validated server-side by the create-account action) is recorded as
--     acceptance rows at the then-current versions. Also fixes the metadata
--     key mismatch: signup sends first_name/last_name/company, but the old
--     function only read full_name/employer, leaving both NULL on every new
--     profile. The old keys remain first choice so other creation paths are
--     unaffected.
--
--  D) Backfill — every existing profile is recorded as having accepted v1 of
--     all three documents (dated from the profile's created_at, since signup
--     has always required consent but never recorded a timestamp). This makes
--     the feature launch silent; the first real version bump gates everyone.
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
-- A) legal_documents — one row per document kind
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legal_documents (
  kind            text        PRIMARY KEY
                              CHECK (kind IN ('privacy_policy', 'terms_of_service', 'eula')),
  current_version integer     NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  url             text        NOT NULL,
  effective_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;

INSERT INTO public.legal_documents (kind, current_version, url) VALUES
  ('privacy_policy',   1, 'https://www.cropwatch.io/legal/privacy-policy'),
  ('terms_of_service', 1, 'https://www.cropwatch.io/legal/terms-of-service'),
  ('eula',             1, 'https://www.cropwatch.io/legal/EULA')
ON CONFLICT (kind) DO NOTHING;

-- ---------------------------------------------------------------------------
-- B) profile_legal_acceptances — append-only audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_legal_acceptances (
  user_id     uuid        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  kind        text        NOT NULL REFERENCES public.legal_documents (kind),
  version     integer     NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, version)
);

ALTER TABLE public.profile_legal_acceptances ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.profiles.accepted_agreements IS
  'DEPRECATED (019): superseded by profile_legal_acceptances. Never read; do not use.';

-- ---------------------------------------------------------------------------
-- C) handle_new_user() — record signup consent + fix metadata key mismatch
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

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- D) Backfill — existing users accepted v1 at (approximately) signup time
-- ---------------------------------------------------------------------------
INSERT INTO public.profile_legal_acceptances (user_id, kind, version, accepted_at)
SELECT p.id, ld.kind, ld.current_version, COALESCE(p.created_at, now())
FROM public.profiles p
CROSS JOIN public.legal_documents ld
ON CONFLICT DO NOTHING;

COMMIT;

-- =============================================================================
-- OPS: publishing an updated document
--
-- Bump the version of the changed document(s); every user is then gated at
-- their next login / page load until they re-accept. Update the URL too if the
-- document moved. No deploy needed.
--
--   UPDATE public.legal_documents
--      SET current_version = current_version + 1,
--          effective_at    = now(),
--          updated_at      = now()
--    WHERE kind = 'terms_of_service';   -- or 'privacy_policy' / 'eula'
-- =============================================================================

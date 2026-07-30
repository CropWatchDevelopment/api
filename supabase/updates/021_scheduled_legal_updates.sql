-- =============================================================================
-- 021_scheduled_legal_updates.sql
-- Scheduled (future-dated) legal document updates, covering one or more
-- documents in a single update event.
--
--  A) legal_document_versions — one row per published OR scheduled version of
--     each document. The CURRENT version of a document is the highest version
--     whose effective_at has passed; scheduling an update is just inserting
--     future-dated rows (see the OPS footer / scripts/Update-Legal.sql).
--     Nothing promotes rows and no cron is involved — the API computes the
--     effective version at read time, so the re-accept gate activates by
--     itself the moment effective_at arrives. Several documents inserted with
--     the same effective_at form one update event: users are gated on all of
--     them at once and re-accept them together on the accept-terms page.
--
--     legal_documents remains as the document-kind registry (and FK target of
--     profile_legal_acceptances.kind); its current_version / url /
--     effective_at columns are superseded by this table and marked deprecated.
--     They are NOT kept in sync after this script runs.
--
--  B) Seed — each document's currently published row in legal_documents is
--     copied in as its latest version, so behavior is unchanged at cutover.
--
--  C) handle_new_user() — full 020 body, with the signup-consent insert now
--     stamping the current EFFECTIVE version from legal_document_versions
--     instead of legal_documents.current_version.
--     Run order: 019, 020, then 021 (this REPLACE includes both).
--
-- Deploy order: run this script first (the live API keeps reading the
-- untouched legal_documents rows), then deploy the API release that reads
-- legal_document_versions. Only schedule updates after that deploy — the old
-- API never looks at this table, so an earlier insert would just stay silent.
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
-- A) legal_document_versions — published + scheduled versions per document
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legal_document_versions (
  kind         text        NOT NULL REFERENCES public.legal_documents (kind),
  version      integer     NOT NULL CHECK (version >= 1),
  url          text        NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, version)
);

ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.legal_document_versions IS
  'Published and scheduled versions of each legal document. The current version of a kind is the highest version with effective_at <= now(); rows with a future effective_at are scheduled updates that activate on their own.';

COMMENT ON COLUMN public.legal_documents.current_version IS
  'DEPRECATED (021): superseded by legal_document_versions; not kept in sync. The table itself remains as the kind registry.';
COMMENT ON COLUMN public.legal_documents.url IS
  'DEPRECATED (021): superseded by legal_document_versions; not kept in sync.';
COMMENT ON COLUMN public.legal_documents.effective_at IS
  'DEPRECATED (021): superseded by legal_document_versions; not kept in sync.';

-- ---------------------------------------------------------------------------
-- B) Seed — copy each document's currently published state as its latest row
-- ---------------------------------------------------------------------------
INSERT INTO public.legal_document_versions (kind, version, url, effective_at)
SELECT kind, current_version, url, effective_at
FROM public.legal_documents
ON CONFLICT (kind, version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- C) handle_new_user() — 020 body, consent stamped from effective versions
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
  SELECT NEW.id, cv.kind, cv.version
  FROM (
    SELECT DISTINCT ON (kind) kind, version
    FROM public.legal_document_versions
    WHERE effective_at <= now()
    ORDER BY kind, version DESC
  ) cv
  WHERE (cv.kind = 'privacy_policy'   AND NEW.raw_user_meta_data->>'agreed_privacy' = 'true')
     OR (cv.kind = 'terms_of_service' AND NEW.raw_user_meta_data->>'agreed_terms'   = 'true')
     OR (cv.kind = 'eula'             AND NEW.raw_user_meta_data->>'agreed_eula'    = 'true')
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
-- OPS: scheduling (or immediately publishing) a legal update
--
-- Maintained copy: scripts/Update-Legal.sql. List every document changing in
-- this update — one row per document, all sharing the same effective_at so
-- users re-accept them all at once. Use now() to publish immediately. Version
-- numbers are assigned automatically. No deploy needed.
--
--   INSERT INTO public.legal_document_versions (kind, version, url, effective_at)
--   SELECT u.kind,
--          (SELECT COALESCE(MAX(v.version), 0) + 1
--             FROM public.legal_document_versions v
--            WHERE v.kind = u.kind),
--          u.url,
--          u.effective_at
--   FROM (VALUES   -- keep only the rows for the documents that changed
--     ('eula',             'https://www.cropwatch.io/legal/EULA',             timestamptz '2026-09-01 00:00:00+09'),
--     ('terms_of_service', 'https://www.cropwatch.io/legal/terms-of-service', timestamptz '2026-09-01 00:00:00+09'),
--     ('privacy_policy',   'https://www.cropwatch.io/legal/privacy-policy',   timestamptz '2026-09-01 00:00:00+09')
--   ) AS u(kind, url, effective_at);
--
-- Review scheduled-but-not-yet-effective updates:
--   SELECT * FROM public.legal_document_versions WHERE effective_at > now() ORDER BY effective_at, kind;
--
-- Cancel one before it takes effect (harmless while effective_at is future):
--   DELETE FROM public.legal_document_versions WHERE kind = 'eula' AND effective_at > now();
-- =============================================================================

-- Schedule (or immediately publish) a legal document update.
--
-- List every document changing in THIS update — one row per document, all
-- sharing the same effective_at, so users are gated on all of them at once and
-- re-accept them together. Use now() as effective_at to publish immediately;
-- a future timestamp activates the re-accept gate by itself at that moment
-- (no deploy, no cron). Version numbers are assigned automatically.
-- Mechanism: api/supabase/updates/021_scheduled_legal_updates.sql
--
-- URL rules — the app does NOT link users to the URL stored here. It builds the
-- policy links per UI locale (CropWatch/src/lib/i18n/legal-urls.ts: en ->
-- https://cropwatch.io/legal/..., ja -> https://cropwatch.co.jp/legal/...), so
-- this column is a record of which published document the version refers to.
-- Always store the apex canonical host. NEVER use www.cropwatch.co.jp: that host
-- is not attached to the Vercel project serving the site, its certificate is
-- not renewed, and the v2 rows published 2026-07-31 with it locked 80+ users
-- behind a browser certificate error on the re-accept page.

INSERT INTO public.legal_document_versions (kind, version, url, effective_at)
SELECT u.kind,
       (SELECT COALESCE(MAX(v.version), 0) + 1
          FROM public.legal_document_versions v
         WHERE v.kind = u.kind),
       u.url,
       u.effective_at
FROM (VALUES   -- keep only the rows for the documents that changed
  ('eula',             'https://cropwatch.io/legal/EULA',             timestamptz '2026-08-01 00:00:00+09'),
  -- ('terms_of_service', 'https://cropwatch.io/legal/terms-of-service', timestamptz '2026-08-01 00:00:00+09'),
  -- ('privacy_policy',   'https://cropwatch.io/legal/privacy-policy',   timestamptz '2026-08-01 00:00:00+09')
) AS u(kind, url, effective_at);

-- Review scheduled-but-not-yet-effective updates:
--   SELECT * FROM public.legal_document_versions WHERE effective_at > now() ORDER BY effective_at, kind;

-- Cancel a scheduled update before it takes effect:
--   DELETE FROM public.legal_document_versions WHERE kind = 'eula' AND effective_at > now();

-- HOTFIX (2026-10-13): repair rows that were published with the www host.
-- Idempotent; safe to re-run.
--   UPDATE public.legal_document_versions
--      SET url = replace(url, 'https://www.cropwatch.co.jp/', 'https://cropwatch.co.jp/')
--    WHERE url LIKE 'https://www.cropwatch.co.jp/%';

-- Schedule (or immediately publish) a legal document update.
--
-- List every document changing in THIS update — one row per document, all
-- sharing the same effective_at, so users are gated on all of them at once and
-- re-accept them together. Use now() as effective_at to publish immediately;
-- a future timestamp activates the re-accept gate by itself at that moment
-- (no deploy, no cron). Version numbers are assigned automatically.
-- Mechanism: api/supabase/updates/021_scheduled_legal_updates.sql

INSERT INTO public.legal_document_versions (kind, version, url, effective_at)
SELECT u.kind,
       (SELECT COALESCE(MAX(v.version), 0) + 1
          FROM public.legal_document_versions v
         WHERE v.kind = u.kind),
       u.url,
       u.effective_at
FROM (VALUES   -- keep only the rows for the documents that changed
  ('eula',             'https://www.cropwatch.co.jp/legal/EULA',             timestamptz '2026-08-01 00:00:00+09'),
  -- ('terms_of_service', 'https://www.cropwatch.co.jp/legal/terms-of-service', timestamptz '2026-08-01 00:00:00+09'),
  -- ('privacy_policy',   'https://www.cropwatch.co.jp/legal/privacy-policy',   timestamptz '2026-08-01 00:00:00+09')
) AS u(kind, url, effective_at);

-- Review scheduled-but-not-yet-effective updates:
--   SELECT * FROM public.legal_document_versions WHERE effective_at > now() ORDER BY effective_at, kind;

-- Cancel a scheduled update before it takes effect:
--   DELETE FROM public.legal_document_versions WHERE kind = 'eula' AND effective_at > now();

-- =============================================================================
-- 016_report_regeneration_queue.sql
-- Queue that lets users request regeneration of an already-generated report
-- PDF after editing its data-point notes (cw_air_annotations).
--
-- Producer: the Nest API (POST /v1/reports/:id/regenerate) inserts a row after
-- a user saves note edits on the report-data edit page.
-- Consumer: CW-Reports (cw-report-sender) polls this table during its normal
-- scheduled cron runs, regenerates the PDF for the stored period, uploads it to
-- the `Reports` storage bucket as `<range>_updated_<datetime>.pdf` next to the
-- untouched original, and marks the row completed/failed. Regenerated reports
-- are stored only — never emailed.
--
-- Design notes:
--  * A report has no UUID anywhere in the system — its identity is
--    (template_id, dev_eui) plus the period encoded in the storage object name
--    (`YYYY_MM_DD-YYYY_MM_DD.pdf`). The row therefore carries all of it.
--  * status is text + CHECK (the DB has no enums; matches device_licenses.status
--    per 010/014 convention).
--  * The partial unique index dedupes pending work: repeated saves on the same
--    (template, device, period) re-touch the one pending row instead of stacking
--    jobs. It deliberately does NOT block a new pending row while another is
--    processing — an in-flight regeneration may miss the newest note edits, and
--    the next cron run must be able to pick those up.
--  * Claiming is a conditional UPDATE (status 'pending' -> 'processing' filtered
--    on id AND status) so the daily and weekly crons cannot double-generate.
--  * Editability is capped API-side at periods ending within the last 23 months
--    (24-month data retention minus up to a month of cron lag); the consumer
--    re-checks defensively for rows that age out while queued.
--
-- RLS is enabled with no anon/authenticated policies, matching the posture of
-- 002_enable_rls_all_public.sql: the API and CW-Reports both use service-role
-- clients and authorization is enforced in Nest.
--
-- Idempotent: CREATE ... IF NOT EXISTS.
-- Regenerate database.types.ts (api + CropWatch) after running.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.cw_report_regeneration_queue (
  id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id        bigint      NOT NULL
                                 REFERENCES public.cw_report_templates (id) ON DELETE CASCADE,
  dev_eui            text        NOT NULL
                                 REFERENCES public.cw_devices (dev_eui) ON DELETE CASCADE,
  period_start       timestamptz NOT NULL,
  period_end         timestamptz NOT NULL,
  timezone           text        NOT NULL DEFAULT 'Asia/Tokyo', -- IANA zone the report window is computed in
  source_object_name text        NOT NULL,             -- original storage object, e.g. 2026_07_12-2026_07_18.pdf
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  requested_by       text        NOT NULL,             -- user email (mirrors cw_air_annotations.created_by)
  requested_at       timestamptz NOT NULL DEFAULT now(),
  claimed_at         timestamptz,
  completed_at       timestamptz,
  attempts           integer     NOT NULL DEFAULT 0,
  last_error         text,
  output_object_name text,                             -- set on completion: <range>_updated_<ts>.pdf
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);

-- At most ONE pending row per (template, device, period): repeated saves
-- re-touch the existing pending row instead of stacking duplicate jobs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cw_report_regeneration_queue_pending_dedupe
  ON public.cw_report_regeneration_queue (template_id, dev_eui, period_start, period_end)
  WHERE status = 'pending';

-- The consumer polls `WHERE status = 'pending' ORDER BY requested_at`.
CREATE INDEX IF NOT EXISTS idx_cw_report_regeneration_queue_status
  ON public.cw_report_regeneration_queue (status, requested_at);

ALTER TABLE public.cw_report_regeneration_queue ENABLE ROW LEVEL SECURITY;

-- Additive (safe to re-run on an already-created table): running tally of note
-- edits covered by this queue row. Each save re-touching the pending row adds
-- its op count; the history dialog surfaces it next to the pending badge.
ALTER TABLE public.cw_report_regeneration_queue
  ADD COLUMN IF NOT EXISTS edit_count integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.cw_report_regeneration_queue.source_object_name IS
  'Storage object name of the original PDF inside the Reports/<dev_eui>/ folder; the period is also encoded here as YYYY_MM_DD-YYYY_MM_DD.';
COMMENT ON COLUMN public.cw_report_regeneration_queue.output_object_name IS
  'Storage object name of the regenerated PDF (<range>_updated_<YYYYMMDD_HHMM>.pdf); NULL until completed.';

COMMIT;

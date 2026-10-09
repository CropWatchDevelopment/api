-- =============================================================================
-- 029_reports_storage_lockdown.sql
-- =============================================================================
-- Closes a cross-customer leak in the `Reports` storage bucket.
--
-- The storage.objects policy "Give users authenticated access to folder
-- 19msfxb_0" was  FOR SELECT USING (bucket_id = 'Reports' AND
-- auth.role() = 'authenticated'):  ANY signed-in user — and anyone can sign
-- up — could list and download every device's report PDFs straight from the
-- Storage API. (anon/authenticated hold full table privileges on
-- storage.objects, so RLS policies are the only gate.)
--
-- Fix: drop it and put NOTHING in its place. Report files are then reachable
-- only through the API, which already enforces "at least read access" on the
-- device (Action.DeviceRead: staff, implicit owner, org owner/manager,
-- parent-org read link, or a grant at Viewer or better — Disabled excluded):
--   * GET  /v1/reports/:id/history  lists files only for assigned devices the
--     caller can view (findOne filters assignments to canView devices);
--   * GET  /v1/reports/download/:dev_eui/:reportName  checks canView for that
--     device, rejects path separators / traversal, and returns a 60-second
--     signed URL.
-- Both run as service_role (bypasses RLS), as does the report generator
-- (CW-Reports requires SUPABASE_SERVICE_ROLE_KEY), so nothing legitimate loses
-- access. No client (CropWatch app, Android, widget) reads the bucket directly.
--
-- Deliberately NOT replaced by a device-aware RLS policy: that would copy the
-- API's access model (org roles, parent links, guest caps, suspended/expired
-- memberships, the ORG_OVERLAY_DISABLED kill-switch, staff) into SQL — a
-- second source of truth that drifts — and keep a direct path no client needs.
-- Same posture as 002–005 for the public tables: clients get nothing from RLS;
-- the API authorizes.
--
-- Run in the SQL editor as postgres (supautils.policy_grants lets postgres
-- manage storage.objects policies). Takes effect immediately; no deploy.
-- Idempotent. The guards abort (rolling everything back) if the bucket is
-- public or if any remaining storage.objects policy is not confined to the
-- avatars bucket — review such a policy by hand before re-running.
-- =============================================================================

BEGIN;

-- Guard 1: a PUBLIC bucket serves every object by URL with no policy check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'Reports' AND public) THEN
    RAISE EXCEPTION 'Reports bucket is PUBLIC: make it private before running 029';
  END IF;
END $$;

DROP POLICY IF EXISTS "Give users authenticated access to folder 19msfxb_0"
  ON storage.objects;

-- Guard 2: every remaining storage.objects policy must be confined to the
-- avatars bucket; anything else could still expose Reports objects.
DO $$
DECLARE
  v_names text;
BEGIN
  SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO v_names
    FROM pg_policies
   WHERE schemaname = 'storage'
     AND tablename = 'objects'
     AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
         NOT LIKE '%bucket_id = ''avatars''::text%';
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'storage.objects policies not confined to the avatars bucket: %', v_names;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- OPS — verification (read-only, run right after COMMIT; keep the output)
-- =============================================================================
-- SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';
-- -- expect only: "Anyone can upload an avatar." (INSERT, avatars) and
-- --              "Avatar images are publicly accessible." (SELECT, avatars)
-- SELECT id, public FROM storage.buckets WHERE id = 'Reports';   -- public = false
--
-- Functional check with a NON-staff test account's access token (any account
-- works; it should see nothing):
--   curl -s -X POST "$SUPABASE_URL/storage/v1/object/list/Reports" \
--     -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $USER_JWT" \
--     -H "Content-Type: application/json" -d '{"prefix":"","limit":5}'
--   -> before 029: device folders;  after 029: []
-- Then confirm in the app that report history and downloads still work for a
-- user with read access to the device (they go through the API).

-- =============================================================================
-- ROLLBACK — re-opens the leak; only if something unforeseen breaks
-- =============================================================================
-- CREATE POLICY "Give users authenticated access to folder 19msfxb_0"
--   ON storage.objects FOR SELECT TO public
--   USING (bucket_id = 'Reports' AND auth.role() = 'authenticated');

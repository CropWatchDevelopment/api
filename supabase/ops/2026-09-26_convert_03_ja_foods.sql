-- ============================================================================
-- 03. Company conversion: JA-Foods
-- Roster: supabase/ops/*_conversion_roster_*.csv (Kevin-approved 2026-09-26)
-- convert → 2 managers + 1 member (Viewer grants kept) + 1 guest
-- (cfwk9053: keeps partial Viewer visibility, NOT expanded). Billing
-- (reporting_manual) keys off takao's user row — unchanged by design.
-- Idempotence: NOT idempotent — run exactly once. Any assert aborts the
-- whole transaction; nothing is applied unless every check passes.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_u uuid; v_org organizations%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '4b455cf3-7f43-4f1d-84ce-88d7a708d9e1' AND lower(email) = lower('takao-harada.70@miyazaki.mz-ja.or.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 4b455cf3-7f43-4f1d-84ce-88d7a708d9e1 is not takao-harada.70@miyazaki.mz-ja.or.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'ef25630b-5068-4a68-b3bd-bd8f933de110' AND lower(email) = lower('cfwk9053@yahoo.co.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid ef25630b-5068-4a68-b3bd-bd8f933de110 is not cfwk9053@yahoo.co.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '414e6cf2-c7ab-4cef-bbb3-958b97bc1131' AND lower(email) = lower('aono_koh@kei.mz-ja.or.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 414e6cf2-c7ab-4cef-bbb3-958b97bc1131 is not aono_koh@kei.mz-ja.or.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '0a1a9ee1-e57c-4120-be2e-5137a441f057' AND lower(email) = lower('matsumoto_yuu@kei.mz-ja.or.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 0a1a9ee1-e57c-4120-be2e-5137a441f057 is not matsumoto_yuu@kei.mz-ja.or.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '3abcded1-8377-436a-b5b9-5d0835a6c1ce' AND lower(email) = lower('info@jafoods-miyazaki.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 3abcded1-8377-436a-b5b9-5d0835a6c1ce is not info@jafoods-miyazaki.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = '60c05483-db90-4da3-9f33-6024da1b1c50' AND type = 'personal'
                  AND home_of_user_id = '4b455cf3-7f43-4f1d-84ce-88d7a708d9e1' AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'PREFLIGHT: JA org state changed';
  END IF;
  -- cfwk9053 must already be Viewer-only here (no downgrade intended)
  IF EXISTS (SELECT 1 FROM cw_location_owners lo JOIN cw_locations l ON l.location_id = lo.location_id
              WHERE l.org_id = '60c05483-db90-4da3-9f33-6024da1b1c50' AND lo.user_id = 'ef25630b-5068-4a68-b3bd-bd8f933de110' AND lo.permission_level < 4)
  OR EXISTS (SELECT 1 FROM cw_device_owners dw JOIN cw_devices d ON d.dev_eui = dw.dev_eui
              WHERE d.org_id = '60c05483-db90-4da3-9f33-6024da1b1c50' AND dw.user_id = 'ef25630b-5068-4a68-b3bd-bd8f933de110' AND dw.permission_level < 4) THEN
    RAISE EXCEPTION 'PREFLIGHT: cfwk9053 unexpectedly holds a grant stronger than Viewer';
  END IF;
  -- Full joiners must have an empty ACTIVE personal org and no billing
  FOR v_u IN SELECT unnest(ARRAY['414e6cf2-c7ab-4cef-bbb3-958b97bc1131', '0a1a9ee1-e57c-4120-be2e-5137a441f057', '3abcded1-8377-436a-b5b9-5d0835a6c1ce']::uuid[])
  LOOP
    SELECT * INTO v_org FROM organizations
     WHERE home_of_user_id = v_u AND deactivated_at IS NULL;
    IF NOT FOUND OR v_org.type <> 'personal' THEN
      RAISE EXCEPTION 'PREFLIGHT: % has no active personal org (or it is a company)', v_u;
    END IF;
    IF EXISTS (SELECT 1 FROM cw_locations WHERE org_id = v_org.id)
    OR EXISTS (SELECT 1 FROM cw_devices   WHERE org_id = v_org.id)
    OR EXISTS (SELECT 1 FROM device_licenses WHERE user_id = v_u)
    OR EXISTS (SELECT 1 FROM billing_customers WHERE user_id = v_u
                AND (device_subscription_id IS NOT NULL
                     OR reporting_subscription_id IS NOT NULL OR device_seats > 0)) THEN
      RAISE EXCEPTION 'PREFLIGHT: personal org of % is not empty', v_u;
    END IF;
    IF EXISTS (SELECT 1 FROM organization_members m JOIN organizations o ON o.id = m.org_id
                WHERE m.user_id = v_u AND m.role IN ('owner','manager','member')
                  AND o.deactivated_at IS NULL AND o.id <> v_org.id) THEN
      RAISE EXCEPTION 'PREFLIGHT: % already holds another full membership', v_u;
    END IF;
  END LOOP;
END $$;

SELECT convert_org_to_company('60c05483-db90-4da3-9f33-6024da1b1c50', 'JA-Foods', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Park each joiner's personal org (single-org rule), then add memberships.
UPDATE organizations
   SET deactivated_at = now()
 WHERE home_of_user_id IN ('414e6cf2-c7ab-4cef-bbb3-958b97bc1131', '0a1a9ee1-e57c-4120-be2e-5137a441f057', '3abcded1-8377-436a-b5b9-5d0835a6c1ce')
   AND deactivated_at IS NULL AND type = 'personal';

DO $$
BEGIN
  IF (SELECT count(*) FROM organizations
       WHERE home_of_user_id IN ('414e6cf2-c7ab-4cef-bbb3-958b97bc1131', '0a1a9ee1-e57c-4120-be2e-5137a441f057', '3abcded1-8377-436a-b5b9-5d0835a6c1ce') AND deactivated_at IS NOT NULL) <> 3 THEN
    RAISE EXCEPTION 'STEP: expected 3 deactivated personal orgs';
  END IF;
END $$;

INSERT INTO organization_members (org_id, user_id, role, status, invited_by)
VALUES
  ('60c05483-db90-4da3-9f33-6024da1b1c50', '414e6cf2-c7ab-4cef-bbb3-958b97bc1131', 'manager', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('60c05483-db90-4da3-9f33-6024da1b1c50', '0a1a9ee1-e57c-4120-be2e-5137a441f057', 'manager', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('60c05483-db90-4da3-9f33-6024da1b1c50', '3abcded1-8377-436a-b5b9-5d0835a6c1ce', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Guests: personal orgs stay active; unlimited guest seats.
INSERT INTO organization_members (org_id, user_id, role, status, invited_by)
VALUES
  ('60c05483-db90-4da3-9f33-6024da1b1c50', 'ef25630b-5068-4a68-b3bd-bd8f933de110', 'guest', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723');

DO $$
BEGIN
  IF (SELECT count(*) FROM organization_members WHERE org_id = '60c05483-db90-4da3-9f33-6024da1b1c50' AND role = 'owner' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: expected 1 owner row(s)';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = '60c05483-db90-4da3-9f33-6024da1b1c50' AND role = 'manager' AND status = 'active') <> 2 THEN
    RAISE EXCEPTION 'VERIFY: expected 2 manager row(s)';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = '60c05483-db90-4da3-9f33-6024da1b1c50' AND role = 'member' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: expected 1 member row(s)';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = '60c05483-db90-4da3-9f33-6024da1b1c50' AND role = 'guest' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: expected 1 guest row(s)';
  END IF;
  IF EXISTS (SELECT 1 FROM cw_location_owners lo JOIN cw_locations l ON l.location_id = lo.location_id
              WHERE l.org_id = '60c05483-db90-4da3-9f33-6024da1b1c50' AND lo.user_id IN ('ef25630b-5068-4a68-b3bd-bd8f933de110')
                AND lo.is_active AND lo.permission_level < 4)
  OR EXISTS (SELECT 1 FROM cw_device_owners dw JOIN cw_devices d ON d.dev_eui = dw.dev_eui
              WHERE d.org_id = '60c05483-db90-4da3-9f33-6024da1b1c50' AND dw.user_id IN ('ef25630b-5068-4a68-b3bd-bd8f933de110')
                AND dw.permission_level < 4) THEN
    RAISE EXCEPTION 'VERIFY: a guest still holds a grant stronger than Viewer';
  END IF;
END $$;

COMMIT;

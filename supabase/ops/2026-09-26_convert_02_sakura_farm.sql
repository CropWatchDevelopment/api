-- ============================================================================
-- 02. Company conversion: 株式会社 サクラファーム
-- Roster: supabase/ops/*_conversion_roster_*.csv (Kevin-approved 2026-09-26)
-- convert → 1 manager + 7 members join. Grants untouched (members keep
-- today's access; kill-switch fallback preserved).
-- Idempotence: NOT idempotent — run exactly once. Any assert aborts the
-- whole transaction; nothing is applied unless every check passes.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_u uuid; v_org organizations%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '3b5bc6ae-db73-4a5a-b04e-2c8467e4c5bb' AND lower(email) = lower('baio010@icloud.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 3b5bc6ae-db73-4a5a-b04e-2c8467e4c5bb is not baio010@icloud.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'feb4e29d-5df9-411b-ab60-88b28aa83d48' AND lower(email) = lower('baio01giken@ace.ocn.ne.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid feb4e29d-5df9-411b-ab60-88b28aa83d48 is not baio01giken@ace.ocn.ne.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '6257819c-4211-47ed-9789-5b53a235712b' AND lower(email) = lower('baio001@icloud.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 6257819c-4211-47ed-9789-5b53a235712b is not baio001@icloud.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '4b249afb-eef5-431c-8b3d-5c719a0c0afa' AND lower(email) = lower('baio006@icloud.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 4b249afb-eef5-431c-8b3d-5c719a0c0afa is not baio006@icloud.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'c3b170ad-b8a4-4114-aeec-232b1f47e51a' AND lower(email) = lower('baio008@icloud.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid c3b170ad-b8a4-4114-aeec-232b1f47e51a is not baio008@icloud.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '574d99e4-9330-4d45-892b-8a6cb0df831b' AND lower(email) = lower('baio014@icloud.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 574d99e4-9330-4d45-892b-8a6cb0df831b is not baio014@icloud.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'c0f541e9-8fe4-4742-8d03-b029a86fa87b' AND lower(email) = lower('baio015@icloud.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid c0f541e9-8fe4-4742-8d03-b029a86fa87b is not baio015@icloud.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'e01bb0ec-194d-42b2-b504-b7dea25057b9' AND lower(email) = lower('baio03giken@clock.ocn.ne.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid e01bb0ec-194d-42b2-b504-b7dea25057b9 is not baio03giken@clock.ocn.ne.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '4d4aa5fa-0061-4ef0-be15-1eca3f68b2aa' AND lower(email) = lower('kodama03@helen.ocn.ne.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 4d4aa5fa-0061-4ef0-be15-1eca3f68b2aa is not kodama03@helen.ocn.ne.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = '926ea824-203e-44c4-8904-7d798ec5df11' AND type = 'personal'
                  AND home_of_user_id = '3b5bc6ae-db73-4a5a-b04e-2c8467e4c5bb' AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'PREFLIGHT: サクラファーム org state changed';
  END IF;
  -- Full joiners must have an empty ACTIVE personal org and no billing
  FOR v_u IN SELECT unnest(ARRAY['feb4e29d-5df9-411b-ab60-88b28aa83d48', '6257819c-4211-47ed-9789-5b53a235712b', '4b249afb-eef5-431c-8b3d-5c719a0c0afa', 'c3b170ad-b8a4-4114-aeec-232b1f47e51a', '574d99e4-9330-4d45-892b-8a6cb0df831b', 'c0f541e9-8fe4-4742-8d03-b029a86fa87b', 'e01bb0ec-194d-42b2-b504-b7dea25057b9', '4d4aa5fa-0061-4ef0-be15-1eca3f68b2aa']::uuid[])
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

SELECT convert_org_to_company('926ea824-203e-44c4-8904-7d798ec5df11', '株式会社 サクラファーム', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Park each joiner's personal org (single-org rule), then add memberships.
UPDATE organizations
   SET deactivated_at = now()
 WHERE home_of_user_id IN ('feb4e29d-5df9-411b-ab60-88b28aa83d48', '6257819c-4211-47ed-9789-5b53a235712b', '4b249afb-eef5-431c-8b3d-5c719a0c0afa', 'c3b170ad-b8a4-4114-aeec-232b1f47e51a', '574d99e4-9330-4d45-892b-8a6cb0df831b', 'c0f541e9-8fe4-4742-8d03-b029a86fa87b', 'e01bb0ec-194d-42b2-b504-b7dea25057b9', '4d4aa5fa-0061-4ef0-be15-1eca3f68b2aa')
   AND deactivated_at IS NULL AND type = 'personal';

DO $$
BEGIN
  IF (SELECT count(*) FROM organizations
       WHERE home_of_user_id IN ('feb4e29d-5df9-411b-ab60-88b28aa83d48', '6257819c-4211-47ed-9789-5b53a235712b', '4b249afb-eef5-431c-8b3d-5c719a0c0afa', 'c3b170ad-b8a4-4114-aeec-232b1f47e51a', '574d99e4-9330-4d45-892b-8a6cb0df831b', 'c0f541e9-8fe4-4742-8d03-b029a86fa87b', 'e01bb0ec-194d-42b2-b504-b7dea25057b9', '4d4aa5fa-0061-4ef0-be15-1eca3f68b2aa') AND deactivated_at IS NOT NULL) <> 8 THEN
    RAISE EXCEPTION 'STEP: expected 8 deactivated personal orgs';
  END IF;
END $$;

INSERT INTO organization_members (org_id, user_id, role, status, invited_by)
VALUES
  ('926ea824-203e-44c4-8904-7d798ec5df11', 'feb4e29d-5df9-411b-ab60-88b28aa83d48', 'manager', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('926ea824-203e-44c4-8904-7d798ec5df11', '6257819c-4211-47ed-9789-5b53a235712b', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('926ea824-203e-44c4-8904-7d798ec5df11', '4b249afb-eef5-431c-8b3d-5c719a0c0afa', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('926ea824-203e-44c4-8904-7d798ec5df11', 'c3b170ad-b8a4-4114-aeec-232b1f47e51a', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('926ea824-203e-44c4-8904-7d798ec5df11', '574d99e4-9330-4d45-892b-8a6cb0df831b', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('926ea824-203e-44c4-8904-7d798ec5df11', 'c0f541e9-8fe4-4742-8d03-b029a86fa87b', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('926ea824-203e-44c4-8904-7d798ec5df11', 'e01bb0ec-194d-42b2-b504-b7dea25057b9', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('926ea824-203e-44c4-8904-7d798ec5df11', '4d4aa5fa-0061-4ef0-be15-1eca3f68b2aa', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723');

DO $$
BEGIN
  IF (SELECT count(*) FROM organization_members WHERE org_id = '926ea824-203e-44c4-8904-7d798ec5df11' AND role = 'owner' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: expected 1 owner row(s)';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = '926ea824-203e-44c4-8904-7d798ec5df11' AND role = 'manager' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: expected 1 manager row(s)';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = '926ea824-203e-44c4-8904-7d798ec5df11' AND role = 'member' AND status = 'active') <> 7 THEN
    RAISE EXCEPTION 'VERIFY: expected 7 member row(s)';
  END IF;
END $$;

COMMIT;

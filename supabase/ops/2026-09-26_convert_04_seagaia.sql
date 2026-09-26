-- ============================================================================
-- 04. Company conversion: シーガイアオーシャンリゾート (Seagaia)
-- Roster: supabase/ops/*_conversion_roster_*.csv (Kevin-approved 2026-09-26)
-- convert → 3 managers + 2 members (Oda/Kuroki keep their Viewer device
-- overrides — grants untouched) → kadomura (departed): grants deleted,
-- account keeps its empty personal org.
-- Idempotence: NOT idempotent — run exactly once. Any assert aborts the
-- whole transaction; nothing is applied unless every check passes.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_u uuid; v_org organizations%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '11791e39-f6d5-4417-93ca-0064560b6031' AND lower(email) = lower('goppi015@gmail.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 11791e39-f6d5-4417-93ca-0064560b6031 is not goppi015@gmail.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '6c59dd6f-f789-446a-a81a-63a0bacd17be' AND lower(email) = lower('kimio.kadomura@seagaia.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 6c59dd6f-f789-446a-a81a-63a0bacd17be is not kimio.kadomura@seagaia.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '953e854b-e35e-436a-9d78-81a881c2381c' AND lower(email) = lower('Masaya.Nakajima@seagaia.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 953e854b-e35e-436a-9d78-81a881c2381c is not Masaya.Nakajima@seagaia.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '3ac711c6-0e62-466f-b952-28395aa2895c' AND lower(email) = lower('Yuta.Saiga@seagaia.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 3ac711c6-0e62-466f-b952-28395aa2895c is not Yuta.Saiga@seagaia.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'c4b31f27-d48c-4cdb-818e-b920ab66951f' AND lower(email) = lower('tsuyoshi.takada@seagaia.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid c4b31f27-d48c-4cdb-818e-b920ab66951f is not tsuyoshi.takada@seagaia.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '9150a003-9919-4b24-9c4f-765c268ebe4f' AND lower(email) = lower('Masaru.Oda@seagaia.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 9150a003-9919-4b24-9c4f-765c268ebe4f is not Masaru.Oda@seagaia.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'd631d835-a165-4f50-8e07-db75399de3b1' AND lower(email) = lower('takayuki.kuroki@seagaia.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid d631d835-a165-4f50-8e07-db75399de3b1 is not takayuki.kuroki@seagaia.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = '15d6b64c-86eb-45bf-bd65-01295a85ed7e' AND type = 'personal'
                  AND home_of_user_id = '11791e39-f6d5-4417-93ca-0064560b6031' AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'PREFLIGHT: Seagaia org state changed';
  END IF;
  IF (SELECT count(*) FROM cw_locations WHERE org_id = '15d6b64c-86eb-45bf-bd65-01295a85ed7e') <> 4
  OR (SELECT count(*) FROM cw_devices  WHERE org_id = '15d6b64c-86eb-45bf-bd65-01295a85ed7e') <> 41 THEN
    RAISE EXCEPTION 'PREFLIGHT: Seagaia holdings changed (expected 4 locations / 41 devices)';
  END IF;
  -- Full joiners must have an empty ACTIVE personal org and no billing
  FOR v_u IN SELECT unnest(ARRAY['953e854b-e35e-436a-9d78-81a881c2381c', '3ac711c6-0e62-466f-b952-28395aa2895c', 'c4b31f27-d48c-4cdb-818e-b920ab66951f', '9150a003-9919-4b24-9c4f-765c268ebe4f', 'd631d835-a165-4f50-8e07-db75399de3b1']::uuid[])
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

SELECT convert_org_to_company('15d6b64c-86eb-45bf-bd65-01295a85ed7e', 'シーガイアオーシャンリゾート', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Park each joiner's personal org (single-org rule), then add memberships.
UPDATE organizations
   SET deactivated_at = now()
 WHERE home_of_user_id IN ('953e854b-e35e-436a-9d78-81a881c2381c', '3ac711c6-0e62-466f-b952-28395aa2895c', 'c4b31f27-d48c-4cdb-818e-b920ab66951f', '9150a003-9919-4b24-9c4f-765c268ebe4f', 'd631d835-a165-4f50-8e07-db75399de3b1')
   AND deactivated_at IS NULL AND type = 'personal';

DO $$
BEGIN
  IF (SELECT count(*) FROM organizations
       WHERE home_of_user_id IN ('953e854b-e35e-436a-9d78-81a881c2381c', '3ac711c6-0e62-466f-b952-28395aa2895c', 'c4b31f27-d48c-4cdb-818e-b920ab66951f', '9150a003-9919-4b24-9c4f-765c268ebe4f', 'd631d835-a165-4f50-8e07-db75399de3b1') AND deactivated_at IS NOT NULL) <> 5 THEN
    RAISE EXCEPTION 'STEP: expected 5 deactivated personal orgs';
  END IF;
END $$;

INSERT INTO organization_members (org_id, user_id, role, status, invited_by)
VALUES
  ('15d6b64c-86eb-45bf-bd65-01295a85ed7e', '953e854b-e35e-436a-9d78-81a881c2381c', 'manager', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('15d6b64c-86eb-45bf-bd65-01295a85ed7e', '3ac711c6-0e62-466f-b952-28395aa2895c', 'manager', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('15d6b64c-86eb-45bf-bd65-01295a85ed7e', 'c4b31f27-d48c-4cdb-818e-b920ab66951f', 'manager', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('15d6b64c-86eb-45bf-bd65-01295a85ed7e', '9150a003-9919-4b24-9c4f-765c268ebe4f', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('15d6b64c-86eb-45bf-bd65-01295a85ed7e', 'd631d835-a165-4f50-8e07-db75399de3b1', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Departed (kadomura): remove access only; his personal org stays active.
DELETE FROM cw_location_owners lo
 USING cw_locations l
 WHERE l.location_id = lo.location_id AND l.org_id = '15d6b64c-86eb-45bf-bd65-01295a85ed7e' AND lo.user_id = '6c59dd6f-f789-446a-a81a-63a0bacd17be';
DELETE FROM cw_device_owners dw
 USING cw_devices d
 WHERE d.dev_eui = dw.dev_eui AND d.org_id = '15d6b64c-86eb-45bf-bd65-01295a85ed7e' AND dw.user_id = '6c59dd6f-f789-446a-a81a-63a0bacd17be';

DO $$
BEGIN
  IF (SELECT count(*) FROM organization_members WHERE org_id = '15d6b64c-86eb-45bf-bd65-01295a85ed7e' AND role = 'owner' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: expected 1 owner row(s)';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = '15d6b64c-86eb-45bf-bd65-01295a85ed7e' AND role = 'manager' AND status = 'active') <> 3 THEN
    RAISE EXCEPTION 'VERIFY: expected 3 manager row(s)';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = '15d6b64c-86eb-45bf-bd65-01295a85ed7e' AND role = 'member' AND status = 'active') <> 2 THEN
    RAISE EXCEPTION 'VERIFY: expected 2 member row(s)';
  END IF;
  IF EXISTS (SELECT 1 FROM cw_location_owners lo JOIN cw_locations l ON l.location_id = lo.location_id
              WHERE l.org_id = '15d6b64c-86eb-45bf-bd65-01295a85ed7e' AND lo.user_id = '6c59dd6f-f789-446a-a81a-63a0bacd17be')
  OR EXISTS (SELECT 1 FROM cw_device_owners dw JOIN cw_devices d ON d.dev_eui = dw.dev_eui
              WHERE d.org_id = '15d6b64c-86eb-45bf-bd65-01295a85ed7e' AND dw.user_id = '6c59dd6f-f789-446a-a81a-63a0bacd17be') THEN
    RAISE EXCEPTION 'VERIFY: kadomura still has grants';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE home_of_user_id = '6c59dd6f-f789-446a-a81a-63a0bacd17be' AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'VERIFY: kadomura personal org missing';
  END IF;
END $$;

COMMIT;

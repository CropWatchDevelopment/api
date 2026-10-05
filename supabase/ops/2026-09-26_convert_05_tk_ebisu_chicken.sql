-- ============================================================================
-- 05. Company conversion: TKエビス 養鶏部門 (chicken division)
-- Roster: supabase/ops/*_conversion_roster_*.csv (Kevin-approved 2026-09-26)
-- convert n-matsuno's org → MOVE 五反田(144)+長田(65) in from
-- w-higashiyoshi's org (emptying it) → 3 members join → guests
-- w-higashiyoshi + tk.syukei01 get Viewer on ALL 11 locations (overview),
-- their legacy Admin/Manager rows capped to Viewer.
-- Idempotence: NOT idempotent — run exactly once. Any assert aborts the
-- whole transaction; nothing is applied unless every check passes.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_u uuid; v_org organizations%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '50fa123a-eaa5-4ba0-8c49-d829eccc3722' AND lower(email) = lower('n-matsuno@tk-ebisu.co.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 50fa123a-eaa5-4ba0-8c49-d829eccc3722 is not n-matsuno@tk-ebisu.co.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'b67340f5-6877-4428-b0c6-69ae0d306c82' AND lower(email) = lower('w-higashiyoshi@tk-ebisu.co.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid b67340f5-6877-4428-b0c6-69ae0d306c82 is not w-higashiyoshi@tk-ebisu.co.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '4b0aecea-246d-4427-924d-766d7bedc2c7' AND lower(email) = lower('tk.syukei01@gmail.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 4b0aecea-246d-4427-924d-766d7bedc2c7 is not tk.syukei01@gmail.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '1a244c87-d1c2-4815-a33b-d175465aaa9b' AND lower(email) = lower('m-andou@tk-ebisu.co.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 1a244c87-d1c2-4815-a33b-d175465aaa9b is not m-andou@tk-ebisu.co.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = '6729f01d-fb2e-487e-afc5-f4eb08c8443d' AND lower(email) = lower('m-fukudome@tk-ebisu.co.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid 6729f01d-fb2e-487e-afc5-f4eb08c8443d is not m-fukudome@tk-ebisu.co.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'b72a3eb1-6d2e-4171-8acf-91f582a729ca' AND lower(email) = lower('y-kuroki@tk-ebisu.co.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid b72a3eb1-6d2e-4171-8acf-91f582a729ca is not y-kuroki@tk-ebisu.co.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18' AND type = 'personal'
                  AND home_of_user_id = '50fa123a-eaa5-4ba0-8c49-d829eccc3722' AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'PREFLIGHT: chicken org state changed';
  END IF;
  IF (SELECT count(*) FROM cw_locations WHERE org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18') <> 9
  OR (SELECT count(*) FROM cw_devices  WHERE org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18') <> 39 THEN
    RAISE EXCEPTION 'PREFLIGHT: chicken holdings changed (expected 9 locations / 39 devices)';
  END IF;
  -- The two locations moving in
  IF NOT EXISTS (SELECT 1 FROM cw_locations WHERE location_id = 65  AND name = '長田'   AND org_id = 'b3cd4738-d89d-4fac-9e42-d6208d2ee22a')
  OR NOT EXISTS (SELECT 1 FROM cw_locations WHERE location_id = 144 AND name = '五反田' AND org_id = 'b3cd4738-d89d-4fac-9e42-d6208d2ee22a') THEN
    RAISE EXCEPTION 'PREFLIGHT: 五反田/長田 are not where expected';
  END IF;
  IF (SELECT count(*) FROM cw_devices WHERE location_id IN (65, 144)) <> 8 THEN
    RAISE EXCEPTION 'PREFLIGHT: expected 8 devices on 五反田+長田';
  END IF;
  IF (SELECT count(*) FROM cw_locations WHERE org_id = 'b3cd4738-d89d-4fac-9e42-d6208d2ee22a') <> 2 THEN
    RAISE EXCEPTION 'PREFLIGHT: w-higashiyoshi org should own exactly the 2 moving locations';
  END IF;
  -- Full joiners must have an empty ACTIVE personal org and no billing
  FOR v_u IN SELECT unnest(ARRAY['1a244c87-d1c2-4815-a33b-d175465aaa9b', '6729f01d-fb2e-487e-afc5-f4eb08c8443d', 'b72a3eb1-6d2e-4171-8acf-91f582a729ca']::uuid[])
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

SELECT convert_org_to_company('f4dc3b62-4197-4eb3-83ae-16c63eba1b18', 'TKエビス 養鶏部門', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Move 五反田 + 長田 (and their devices) into the chicken company.
-- Legacy owner mirrors follow the company owner (n-matsuno).
UPDATE cw_locations
   SET org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18', owner_id = '50fa123a-eaa5-4ba0-8c49-d829eccc3722'
 WHERE location_id IN (65, 144);
UPDATE cw_devices
   SET org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18', user_id = '50fa123a-eaa5-4ba0-8c49-d829eccc3722'
 WHERE location_id IN (65, 144);

-- Park each joiner's personal org (single-org rule), then add memberships.
UPDATE organizations
   SET deactivated_at = now()
 WHERE home_of_user_id IN ('1a244c87-d1c2-4815-a33b-d175465aaa9b', '6729f01d-fb2e-487e-afc5-f4eb08c8443d', 'b72a3eb1-6d2e-4171-8acf-91f582a729ca')
   AND deactivated_at IS NULL AND type = 'personal';

DO $$
BEGIN
  IF (SELECT count(*) FROM organizations
       WHERE home_of_user_id IN ('1a244c87-d1c2-4815-a33b-d175465aaa9b', '6729f01d-fb2e-487e-afc5-f4eb08c8443d', 'b72a3eb1-6d2e-4171-8acf-91f582a729ca') AND deactivated_at IS NOT NULL) <> 3 THEN
    RAISE EXCEPTION 'STEP: expected 3 deactivated personal orgs';
  END IF;
END $$;

INSERT INTO organization_members (org_id, user_id, role, status, invited_by)
VALUES
  ('f4dc3b62-4197-4eb3-83ae-16c63eba1b18', '1a244c87-d1c2-4815-a33b-d175465aaa9b', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('f4dc3b62-4197-4eb3-83ae-16c63eba1b18', '6729f01d-fb2e-487e-afc5-f4eb08c8443d', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('f4dc3b62-4197-4eb3-83ae-16c63eba1b18', 'b72a3eb1-6d2e-4171-8acf-91f582a729ca', 'member', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Guests: personal orgs stay active; unlimited guest seats.
INSERT INTO organization_members (org_id, user_id, role, status, invited_by)
VALUES
  ('f4dc3b62-4197-4eb3-83ae-16c63eba1b18', 'b67340f5-6877-4428-b0c6-69ae0d306c82', 'guest', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('f4dc3b62-4197-4eb3-83ae-16c63eba1b18', '4b0aecea-246d-4427-924d-766d7bedc2c7', 'guest', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Overview guests: Viewer (4) location grant on EVERY org location
-- (covers gaps, downgrades legacy Admin/Manager rows to the guest cap).
INSERT INTO cw_location_owners (location_id, user_id, permission_level, is_active, admin_user_id)
SELECT l.location_id, u.uid, 4, true, 'fd140e81-7640-4f42-ab52-dff1b5635723'
  FROM cw_locations l
 CROSS JOIN (SELECT unnest(ARRAY['b67340f5-6877-4428-b0c6-69ae0d306c82', '4b0aecea-246d-4427-924d-766d7bedc2c7']::uuid[]) AS uid) u
 WHERE l.org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18'
ON CONFLICT (location_id, user_id)
DO UPDATE SET permission_level = 4, is_active = true;

-- Device rows kept but capped at Viewer (guest cap; also keeps the
-- kill-switch fallback consistent with the new access).
UPDATE cw_device_owners dw
   SET permission_level = 4
  FROM cw_devices d
 WHERE d.dev_eui = dw.dev_eui AND d.org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18'
   AND dw.user_id IN ('b67340f5-6877-4428-b0c6-69ae0d306c82', '4b0aecea-246d-4427-924d-766d7bedc2c7')
   AND (dw.permission_level IS NULL OR dw.permission_level < 4);

DO $$
BEGIN
  IF (SELECT count(*) FROM cw_locations WHERE org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18') <> 11
  OR (SELECT count(*) FROM cw_devices  WHERE org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18') <> 47 THEN
    RAISE EXCEPTION 'VERIFY: chicken org should own 11 locations / 47 devices';
  END IF;
  IF EXISTS (SELECT 1 FROM cw_locations WHERE org_id = 'b3cd4738-d89d-4fac-9e42-d6208d2ee22a')
  OR EXISTS (SELECT 1 FROM cw_devices  WHERE org_id = 'b3cd4738-d89d-4fac-9e42-d6208d2ee22a') THEN
    RAISE EXCEPTION 'VERIFY: w-higashiyoshi org is not empty';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = 'b3cd4738-d89d-4fac-9e42-d6208d2ee22a'
                  AND type = 'personal' AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'VERIFY: w-higashiyoshi personal org must stay active (guest shell)';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18' AND role = 'owner' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: expected 1 owner row(s)';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18' AND role = 'member' AND status = 'active') <> 3 THEN
    RAISE EXCEPTION 'VERIFY: expected 3 member row(s)';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18' AND role = 'guest' AND status = 'active') <> 2 THEN
    RAISE EXCEPTION 'VERIFY: expected 2 guest row(s)';
  END IF;
  -- Both overview guests hold a Viewer grant on every one of the 11 locations
  IF (SELECT count(*) FROM cw_location_owners lo JOIN cw_locations l ON l.location_id = lo.location_id
       WHERE l.org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18' AND lo.user_id IN ('b67340f5-6877-4428-b0c6-69ae0d306c82','4b0aecea-246d-4427-924d-766d7bedc2c7')
         AND lo.is_active AND lo.permission_level = 4) <> 22 THEN
    RAISE EXCEPTION 'VERIFY: overview guests missing Viewer grants (expected 22 rows)';
  END IF;
  IF EXISTS (SELECT 1 FROM cw_location_owners lo JOIN cw_locations l ON l.location_id = lo.location_id
              WHERE l.org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18' AND lo.user_id IN ('b67340f5-6877-4428-b0c6-69ae0d306c82', '4b0aecea-246d-4427-924d-766d7bedc2c7')
                AND lo.is_active AND lo.permission_level < 4)
  OR EXISTS (SELECT 1 FROM cw_device_owners dw JOIN cw_devices d ON d.dev_eui = dw.dev_eui
              WHERE d.org_id = 'f4dc3b62-4197-4eb3-83ae-16c63eba1b18' AND dw.user_id IN ('b67340f5-6877-4428-b0c6-69ae0d306c82', '4b0aecea-246d-4427-924d-766d7bedc2c7')
                AND dw.permission_level < 4) THEN
    RAISE EXCEPTION 'VERIFY: a guest still holds a grant stronger than Viewer';
  END IF;
END $$;

COMMIT;

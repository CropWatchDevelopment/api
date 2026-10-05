-- ============================================================================
-- 06. Company conversion: TKエビス 食品部門 (food division)
-- Roster: supabase/ops/*_conversion_roster_*.csv (Kevin-approved 2026-09-26)
-- convert y-mori's org → s-enoki joins as manager → guests
-- w-higashiyoshi + moriyayoi(gmail) get Viewer on ALL 5 locations.
-- RUN AFTER script 05 (w-higashiyoshi guest rows are independent, but the
-- rehearsal ordering matched 05 → 06).
-- Idempotence: NOT idempotent — run exactly once. Any assert aborts the
-- whole transaction; nothing is applied unless every check passes.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_u uuid; v_org organizations%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'b9f18dc5-7bf9-4bc2-b822-82f768cdac33' AND lower(email) = lower('y-mori@tk-ebisu.co.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid b9f18dc5-7bf9-4bc2-b822-82f768cdac33 is not y-mori@tk-ebisu.co.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'b00e232e-a0c9-41ed-8abd-5c6c645bf3f4' AND lower(email) = lower('s-enoki@tk-ebisu.co.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid b00e232e-a0c9-41ed-8abd-5c6c645bf3f4 is not s-enoki@tk-ebisu.co.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'b5303946-9d7e-4e8c-a646-2b7eef2202aa' AND lower(email) = lower('moriyayoi19810307@gmail.com')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid b5303946-9d7e-4e8c-a646-2b7eef2202aa is not moriyayoi19810307@gmail.com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'b67340f5-6877-4428-b0c6-69ae0d306c82' AND lower(email) = lower('w-higashiyoshi@tk-ebisu.co.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid b67340f5-6877-4428-b0c6-69ae0d306c82 is not w-higashiyoshi@tk-ebisu.co.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = '8e7ddfb2-d465-456d-9d63-4bcee4f27a04' AND type = 'personal'
                  AND home_of_user_id = 'b9f18dc5-7bf9-4bc2-b822-82f768cdac33' AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'PREFLIGHT: food org state changed';
  END IF;
  IF (SELECT count(*) FROM cw_locations WHERE org_id = '8e7ddfb2-d465-456d-9d63-4bcee4f27a04') <> 5
  OR (SELECT count(*) FROM cw_devices  WHERE org_id = '8e7ddfb2-d465-456d-9d63-4bcee4f27a04') <> 4 THEN
    RAISE EXCEPTION 'PREFLIGHT: food holdings changed (expected 5 locations / 4 devices)';
  END IF;
  -- Full joiners must have an empty ACTIVE personal org and no billing
  FOR v_u IN SELECT unnest(ARRAY['b00e232e-a0c9-41ed-8abd-5c6c645bf3f4']::uuid[])
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

SELECT convert_org_to_company('8e7ddfb2-d465-456d-9d63-4bcee4f27a04', 'TKエビス 食品部門', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Park each joiner's personal org (single-org rule), then add memberships.
UPDATE organizations
   SET deactivated_at = now()
 WHERE home_of_user_id IN ('b00e232e-a0c9-41ed-8abd-5c6c645bf3f4')
   AND deactivated_at IS NULL AND type = 'personal';

DO $$
BEGIN
  IF (SELECT count(*) FROM organizations
       WHERE home_of_user_id IN ('b00e232e-a0c9-41ed-8abd-5c6c645bf3f4') AND deactivated_at IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'STEP: expected 1 deactivated personal orgs';
  END IF;
END $$;

INSERT INTO organization_members (org_id, user_id, role, status, invited_by)
VALUES
  ('8e7ddfb2-d465-456d-9d63-4bcee4f27a04', 'b00e232e-a0c9-41ed-8abd-5c6c645bf3f4', 'manager', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Guests: personal orgs stay active; unlimited guest seats.
INSERT INTO organization_members (org_id, user_id, role, status, invited_by)
VALUES
  ('8e7ddfb2-d465-456d-9d63-4bcee4f27a04', 'b67340f5-6877-4428-b0c6-69ae0d306c82', 'guest', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723'),
  ('8e7ddfb2-d465-456d-9d63-4bcee4f27a04', 'b5303946-9d7e-4e8c-a646-2b7eef2202aa', 'guest', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Overview guests: Viewer (4) location grant on EVERY org location
-- (covers gaps, downgrades legacy Admin/Manager rows to the guest cap).
INSERT INTO cw_location_owners (location_id, user_id, permission_level, is_active, admin_user_id)
SELECT l.location_id, u.uid, 4, true, 'fd140e81-7640-4f42-ab52-dff1b5635723'
  FROM cw_locations l
 CROSS JOIN (SELECT unnest(ARRAY['b67340f5-6877-4428-b0c6-69ae0d306c82', 'b5303946-9d7e-4e8c-a646-2b7eef2202aa']::uuid[]) AS uid) u
 WHERE l.org_id = '8e7ddfb2-d465-456d-9d63-4bcee4f27a04'
ON CONFLICT (location_id, user_id)
DO UPDATE SET permission_level = 4, is_active = true;

-- Device rows kept but capped at Viewer (guest cap; also keeps the
-- kill-switch fallback consistent with the new access).
UPDATE cw_device_owners dw
   SET permission_level = 4
  FROM cw_devices d
 WHERE d.dev_eui = dw.dev_eui AND d.org_id = '8e7ddfb2-d465-456d-9d63-4bcee4f27a04'
   AND dw.user_id IN ('b67340f5-6877-4428-b0c6-69ae0d306c82', 'b5303946-9d7e-4e8c-a646-2b7eef2202aa')
   AND (dw.permission_level IS NULL OR dw.permission_level < 4);

DO $$
BEGIN
  IF (SELECT count(*) FROM organization_members WHERE org_id = '8e7ddfb2-d465-456d-9d63-4bcee4f27a04' AND role = 'owner' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: expected 1 owner row(s)';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = '8e7ddfb2-d465-456d-9d63-4bcee4f27a04' AND role = 'manager' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: expected 1 manager row(s)';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = '8e7ddfb2-d465-456d-9d63-4bcee4f27a04' AND role = 'guest' AND status = 'active') <> 2 THEN
    RAISE EXCEPTION 'VERIFY: expected 2 guest row(s)';
  END IF;
  IF (SELECT count(*) FROM cw_location_owners lo JOIN cw_locations l ON l.location_id = lo.location_id
       WHERE l.org_id = '8e7ddfb2-d465-456d-9d63-4bcee4f27a04' AND lo.user_id IN ('b67340f5-6877-4428-b0c6-69ae0d306c82','b5303946-9d7e-4e8c-a646-2b7eef2202aa')
         AND lo.is_active AND lo.permission_level = 4) <> 10 THEN
    RAISE EXCEPTION 'VERIFY: overview guests missing Viewer grants (expected 10 rows)';
  END IF;
  IF EXISTS (SELECT 1 FROM cw_location_owners lo JOIN cw_locations l ON l.location_id = lo.location_id
              WHERE l.org_id = '8e7ddfb2-d465-456d-9d63-4bcee4f27a04' AND lo.user_id IN ('b67340f5-6877-4428-b0c6-69ae0d306c82', 'b5303946-9d7e-4e8c-a646-2b7eef2202aa')
                AND lo.is_active AND lo.permission_level < 4)
  OR EXISTS (SELECT 1 FROM cw_device_owners dw JOIN cw_devices d ON d.dev_eui = dw.dev_eui
              WHERE d.org_id = '8e7ddfb2-d465-456d-9d63-4bcee4f27a04' AND dw.user_id IN ('b67340f5-6877-4428-b0c6-69ae0d306c82', 'b5303946-9d7e-4e8c-a646-2b7eef2202aa')
                AND dw.permission_level < 4) THEN
    RAISE EXCEPTION 'VERIFY: a guest still holds a grant stronger than Viewer';
  END IF;
END $$;

COMMIT;

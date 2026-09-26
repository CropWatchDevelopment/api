-- ============================================================================
-- 01. Company conversion: 児湯広域森林組合 (owner transfer onogawa → hando)
-- Roster: supabase/ops/*_conversion_roster_*.csv (Kevin-approved 2026-09-26)
-- convert → hando joins as manager → staff ownership transfer → detach
-- home_of pointer → remove onogawa (access only; fresh personal org).
-- Idempotence: NOT idempotent — run exactly once. Any assert aborts the
-- whole transaction; nothing is applied unless every check passes.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_u uuid; v_org organizations%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'aa0fe8bd-c416-4def-92c6-9def6027e8b7' AND lower(email) = lower('onogawa@koyuforest.or.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid aa0fe8bd-c416-4def-92c6-9def6027e8b7 is not onogawa@koyuforest.or.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'f0747912-c9dd-4cbe-bb86-9a74358191b8' AND lower(email) = lower('hando@koyuforest.or.jp')) THEN
    RAISE EXCEPTION 'PREFLIGHT: uuid f0747912-c9dd-4cbe-bb86-9a74358191b8 is not hando@koyuforest.or.jp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = 'b194b882-37a3-4e32-a7ad-f5b1e1fae901' AND type = 'personal'
                  AND home_of_user_id = 'aa0fe8bd-c416-4def-92c6-9def6027e8b7' AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'PREFLIGHT: 児湯 org state changed';
  END IF;
  IF (SELECT count(*) FROM cw_locations WHERE org_id = 'b194b882-37a3-4e32-a7ad-f5b1e1fae901') <> 1
  OR (SELECT count(*) FROM cw_devices  WHERE org_id = 'b194b882-37a3-4e32-a7ad-f5b1e1fae901') <> 5 THEN
    RAISE EXCEPTION 'PREFLIGHT: 児湯 holdings changed (expected 1 location / 5 devices)';
  END IF;
  -- Full joiners must have an empty ACTIVE personal org and no billing
  FOR v_u IN SELECT unnest(ARRAY['f0747912-c9dd-4cbe-bb86-9a74358191b8']::uuid[])
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

SELECT convert_org_to_company('b194b882-37a3-4e32-a7ad-f5b1e1fae901', '児湯広域森林組合', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Park each joiner's personal org (single-org rule), then add memberships.
UPDATE organizations
   SET deactivated_at = now()
 WHERE home_of_user_id IN ('f0747912-c9dd-4cbe-bb86-9a74358191b8')
   AND deactivated_at IS NULL AND type = 'personal';

DO $$
BEGIN
  IF (SELECT count(*) FROM organizations
       WHERE home_of_user_id IN ('f0747912-c9dd-4cbe-bb86-9a74358191b8') AND deactivated_at IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'STEP: expected 1 deactivated personal orgs';
  END IF;
END $$;

INSERT INTO organization_members (org_id, user_id, role, status, invited_by)
VALUES
  ('b194b882-37a3-4e32-a7ad-f5b1e1fae901', 'f0747912-c9dd-4cbe-bb86-9a74358191b8', 'manager', 'active', 'fd140e81-7640-4f42-ab52-dff1b5635723');

-- Staff ownership transfer: hando becomes owner, onogawa drops to manager,
-- legacy owner mirrors (cw_locations.owner_id / cw_devices.user_id) follow.
SELECT transfer_org_ownership('b194b882-37a3-4e32-a7ad-f5b1e1fae901', 'f0747912-c9dd-4cbe-bb86-9a74358191b8');

-- The company is no longer "onogawa's home org" — detach the pointer so
-- remove_org_member can give him a fresh personal org.
UPDATE organizations SET home_of_user_id = NULL WHERE id = 'b194b882-37a3-4e32-a7ad-f5b1e1fae901';

-- Departed (access only; account remains): wipes his grants on the org's
-- resources, removes membership, creates his new empty personal org.
SELECT remove_org_member('b194b882-37a3-4e32-a7ad-f5b1e1fae901', 'aa0fe8bd-c416-4def-92c6-9def6027e8b7');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = 'b194b882-37a3-4e32-a7ad-f5b1e1fae901' AND type = 'company'
                  AND name = '児湯広域森林組合' AND home_of_user_id IS NULL) THEN
    RAISE EXCEPTION 'VERIFY: org row wrong';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organization_members WHERE org_id = 'b194b882-37a3-4e32-a7ad-f5b1e1fae901'
                  AND user_id = 'f0747912-c9dd-4cbe-bb86-9a74358191b8' AND role = 'owner' AND status = 'active') THEN
    RAISE EXCEPTION 'VERIFY: hando is not owner';
  END IF;
  IF (SELECT count(*) FROM organization_members WHERE org_id = 'b194b882-37a3-4e32-a7ad-f5b1e1fae901' AND role = 'owner' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: expected 1 owner row(s)';
  END IF;
  IF EXISTS (SELECT 1 FROM organization_members WHERE org_id = 'b194b882-37a3-4e32-a7ad-f5b1e1fae901' AND user_id = 'aa0fe8bd-c416-4def-92c6-9def6027e8b7') THEN
    RAISE EXCEPTION 'VERIFY: onogawa still a member';
  END IF;
  IF EXISTS (SELECT 1 FROM cw_location_owners lo JOIN cw_locations l ON l.location_id = lo.location_id
              WHERE l.org_id = 'b194b882-37a3-4e32-a7ad-f5b1e1fae901' AND lo.user_id = 'aa0fe8bd-c416-4def-92c6-9def6027e8b7')
  OR EXISTS (SELECT 1 FROM cw_device_owners dw JOIN cw_devices d ON d.dev_eui = dw.dev_eui
              WHERE d.org_id = 'b194b882-37a3-4e32-a7ad-f5b1e1fae901' AND dw.user_id = 'aa0fe8bd-c416-4def-92c6-9def6027e8b7') THEN
    RAISE EXCEPTION 'VERIFY: onogawa still has grants';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE home_of_user_id = 'aa0fe8bd-c416-4def-92c6-9def6027e8b7'
                  AND deactivated_at IS NULL AND type = 'personal') THEN
    RAISE EXCEPTION 'VERIFY: onogawa has no fresh personal org';
  END IF;
  IF EXISTS (SELECT 1 FROM cw_locations WHERE org_id = 'b194b882-37a3-4e32-a7ad-f5b1e1fae901' AND owner_id <> 'f0747912-c9dd-4cbe-bb86-9a74358191b8')
  OR EXISTS (SELECT 1 FROM cw_devices  WHERE org_id = 'b194b882-37a3-4e32-a7ad-f5b1e1fae901' AND user_id <> 'f0747912-c9dd-4cbe-bb86-9a74358191b8') THEN
    RAISE EXCEPTION 'VERIFY: legacy owner mirrors did not follow hando';
  END IF;
END $$;

COMMIT;

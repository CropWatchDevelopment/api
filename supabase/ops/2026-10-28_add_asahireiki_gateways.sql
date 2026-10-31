-- ============================================================================
-- Gateway access: info@asahireiki.com → 647FDAFFFE02D202, 647FDAFFFE02D20C
-- Requested by Kevin 2026-10-28.
--   cw_gateways 1342412  eui-647fdafffe02d202  (name: eui-647fdafffe02d202)
--   cw_gateways 1342414  eui-647fdafffe02d20c  (name: uri-gw)
-- Both gateways are unclaimed (org_id NULL, no owner rows) at generation time,
-- so the org_claim_gateway trigger (026) claims them for the user's home org
-- "Kosei Magata" (30009481-8a8b-463a-a83e-51111cb87a3c).
-- An owner row is what puts a gateway in that user's gateway list (API
-- listVisible / canViewGateway).
-- Idempotence: safe to re-run; pairs that already have an owner row are
-- skipped. Any assert aborts the whole transaction.
-- Run the whole file at once (do not run selected statements).
-- ============================================================================
BEGIN;

CREATE TEMP TABLE _gateway_access (
  gateway_row_id bigint NOT NULL,  -- cw_gateways.id
  gateway_id     text   NOT NULL,  -- TTI gateway id (also stored in cw_gateways_owners.gateway_eui, as existing rows do)
  user_id        uuid   NOT NULL,
  email          text   NOT NULL
) ON COMMIT DROP;

INSERT INTO _gateway_access (gateway_row_id, gateway_id, user_id, email) VALUES
  (1342412, 'eui-647fdafffe02d202', '2b3b07bf-1f92-4088-a80e-92002b093ca4', 'info@asahireiki.com'),
  (1342414, 'eui-647fdafffe02d20c', '2b3b07bf-1f92-4088-a80e-92002b093ca4', 'info@asahireiki.com');

-- PREFLIGHT: every pinned id still means what it meant when this was written.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM _gateway_access LOOP
    IF NOT EXISTS (SELECT 1 FROM cw_gateways WHERE id = r.gateway_row_id AND gateway_id = r.gateway_id) THEN
      RAISE EXCEPTION 'PREFLIGHT: cw_gateways.id % is not %', r.gateway_row_id, r.gateway_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = r.user_id AND lower(email) = lower(r.email)) THEN
      RAISE EXCEPTION 'PREFLIGHT: uuid % is not %', r.user_id, r.email;
    END IF;
  END LOOP;
END $$;

INSERT INTO cw_gateways_owners (gateway_id, user_id, gateway_eui)
SELECT a.gateway_row_id, a.user_id, a.gateway_id
  FROM _gateway_access a
 WHERE NOT EXISTS (SELECT 1 FROM cw_gateways_owners o
                    WHERE o.gateway_id = a.gateway_row_id AND o.user_id = a.user_id)
 ORDER BY a.gateway_row_id;

-- VERIFY: both pairs have an owner row; report which org each gateway is in now.
DO $$
DECLARE r record; v_missing int;
BEGIN
  SELECT count(*) INTO v_missing FROM _gateway_access a
   WHERE NOT EXISTS (SELECT 1 FROM cw_gateways_owners o
                      WHERE o.gateway_id = a.gateway_row_id AND o.user_id = a.user_id);
  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'VERIFY: % listed (gateway, user) pairs still have no owner row', v_missing;
  END IF;
  FOR r IN SELECT g.gateway_id, g.gateway_name, g.org_id, o.name AS org_name
             FROM cw_gateways g
             JOIN _gateway_access a ON a.gateway_row_id = g.id
             LEFT JOIN organizations o ON o.id = g.org_id LOOP
    RAISE NOTICE 'OK: % (%) org = % (%)', r.gateway_id, r.gateway_name, r.org_id, r.org_name;
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- ROLLBACK (only if needed; un-claims the gateways only if this claimed them)
-- =============================================================================
-- BEGIN;
-- DELETE FROM cw_gateways_owners
--  WHERE user_id = '2b3b07bf-1f92-4088-a80e-92002b093ca4'
--    AND gateway_id IN (1342412, 1342414);
-- UPDATE cw_gateways SET org_id = NULL
--  WHERE id IN (1342412, 1342414)
--    AND org_id = '30009481-8a8b-463a-a83e-51111cb87a3c'
--    AND NOT EXISTS (SELECT 1 FROM cw_gateways_owners o WHERE o.gateway_id = cw_gateways.id);
-- COMMIT;

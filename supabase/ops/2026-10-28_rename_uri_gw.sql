-- ============================================================================
-- Rename gateway "uri-gw" to the standard eui-<gateway eui> name.
-- Requested by Kevin 2026-10-28.
--   cw_gateways 1342414  eui-647fdafffe02d20c  "uri-gw" → "eui-647fdafffe02d20c"
-- Only cw_gateways.gateway_name changes; the gateway_id (what sightings and
-- owner rows reference) and the gateway's name in TTI stay as they are.
-- cw-gateway-status never rewrites gateway_name on an existing row, so the
-- new name sticks.
-- Idempotence: safe to re-run; a second run finds nothing to rename.
-- ============================================================================
BEGIN;

UPDATE cw_gateways
   SET gateway_name = 'eui-647fdafffe02d20c',
       updated_at = now()
 WHERE id = 1342414
   AND gateway_id = 'eui-647fdafffe02d20c'
   AND gateway_name = 'uri-gw';

-- VERIFY: the row has the new name (aborts the transaction otherwise).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cw_gateways
                  WHERE id = 1342414
                    AND gateway_id = 'eui-647fdafffe02d20c'
                    AND gateway_name = 'eui-647fdafffe02d20c') THEN
    RAISE EXCEPTION 'VERIFY: cw_gateways 1342414 is not named eui-647fdafffe02d20c';
  END IF;
  RAISE NOTICE 'OK: cw_gateways 1342414 is named eui-647fdafffe02d20c';
END $$;

COMMIT;

-- ROLLBACK: UPDATE cw_gateways SET gateway_name = 'uri-gw' WHERE id = 1342414;

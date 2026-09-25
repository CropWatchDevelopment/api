-- 026_gateways_org.sql
-- =============================================================================
-- Gateways become org-owned (plan section 8 / review question 6 — this was
-- meant to ship inside 025 and was split out after 025 had already run).
--
--  A) cw_gateways.org_id — the owning organization. NULL = unclaimed or
--     public-only gateway (allowed; review decision keeps these).
--  B) Backfill from the EARLIEST cw_gateways_owners row whose user still has
--     an active home org.
--  C) Claim trigger: when an owner row is inserted for a gateway with no
--     org yet, the gateway is claimed by that user's active org (their home
--     org, or the org they hold full membership in).
--
-- Additive and idempotent. Run BEFORE deploying the org-aware API (PR-B):
-- its gateway scoping reads org_id. The currently deployed API ignores the
-- column entirely. Patch database.types.ts (api + CropWatch) after.
-- =============================================================================

BEGIN;

-- A) column ------------------------------------------------------------------
ALTER TABLE public.cw_gateways
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations (id);

CREATE INDEX IF NOT EXISTS cw_gateways_org_idx ON public.cw_gateways (org_id);

COMMENT ON COLUMN public.cw_gateways.org_id IS
  'Owning organization (026). Only the org''s Owner and Managers see the gateway; is_public gateways stay visible to everyone. NULL = unclaimed.';

-- B) backfill ----------------------------------------------------------------
UPDATE public.cw_gateways g
   SET org_id = o.id
  FROM (
         SELECT DISTINCT ON (go.gateway_id) go.gateway_id, go.user_id
           FROM public.cw_gateways_owners go
          ORDER BY go.gateway_id, go.id
       ) first_owner
  JOIN public.organizations o
    ON o.home_of_user_id = first_owner.user_id AND o.deactivated_at IS NULL
 WHERE g.org_id IS NULL
   AND first_owner.gateway_id = g.id;

-- C) claim trigger -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_claim_gateway() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT o.id INTO v_org
    FROM organizations o
   WHERE o.home_of_user_id = NEW.user_id AND o.deactivated_at IS NULL;
  IF v_org IS NULL THEN
    SELECT m.org_id INTO v_org
      FROM organization_members m
      JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = NEW.user_id
       AND m.role IN ('owner', 'manager', 'member')
       AND m.status = 'active'
       AND o.deactivated_at IS NULL
     LIMIT 1;
  END IF;
  IF v_org IS NOT NULL THEN
    UPDATE cw_gateways SET org_id = v_org
     WHERE id = NEW.gateway_id AND org_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_claim_gateway ON public.cw_gateways_owners;
CREATE TRIGGER org_claim_gateway
  AFTER INSERT ON public.cw_gateways_owners
  FOR EACH ROW EXECUTE FUNCTION public.org_claim_gateway();

REVOKE ALL ON FUNCTION public.org_claim_gateway() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_claim_gateway() TO service_role;

COMMIT;

-- =============================================================================
-- OPS — verification (read-only, run right after COMMIT)
-- =============================================================================
-- SELECT
--   (SELECT COUNT(*) FROM public.cw_gateways)                        AS gateways,
--   (SELECT COUNT(*) FROM public.cw_gateways WHERE org_id IS NOT NULL) AS org_owned,
--   (SELECT COUNT(*) FROM public.cw_gateways
--     WHERE org_id IS NULL AND NOT is_public)                        AS unclaimed_private;
-- -- List the unclaimed private ones (invisible to non-staff under PR-B until
-- -- claimed or made public):
-- SELECT id, gateway_id, gateway_name FROM public.cw_gateways
--  WHERE org_id IS NULL AND NOT is_public;
-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- BEGIN;
-- DROP TRIGGER IF EXISTS org_claim_gateway ON public.cw_gateways_owners;
-- DROP FUNCTION IF EXISTS public.org_claim_gateway();
-- ALTER TABLE public.cw_gateways DROP COLUMN IF EXISTS org_id;
-- COMMIT;

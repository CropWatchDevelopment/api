-- 025_organizations.sql
-- =============================================================================
-- Organizations v1 (additive). Plan: CropWatch-Organizations-Permissions-Plan
-- sections 5.1 + 4.x. Single-org membership model: a person holds full
-- membership (owner/manager/member) in exactly ONE active org; every other
-- org relationship is a guest seat (view-only, unlimited).
--
--  A) New tables: organizations, organization_members, organization_invites,
--     organization_link_requests (RLS on, no policies — service-role only)
--  B) org_id columns on cw_locations, cw_devices, billing_customers,
--     device_licenses, cw_report_templates (+ is_legacy on the grant tables)
--  C) Missing UNIQUE(location_id, user_id) on cw_location_owners (dedupe
--     first) — the API upserts with onConflict:'location_id,user_id' which
--     silently never had an index to conflict on
--  D) Invariant triggers (one owner, one active full membership, personal
--     orgs are owner+guests only, one level of nesting, owner not
--     suspendable/deletable, guest grants capped at Viewer)
--  E) Backfill: one active Personal "home" org per profile, org_id
--     everywhere, legacy markers, implicit-device-owner normalization
--  F) Compatibility triggers: keep the CURRENTLY DEPLOYED (org-unaware) API
--     writing consistent rows until PR-B ships; location→device org
--     propagation is permanent
--  G) handle_new_user(): full 021 body + home-org creation (account_type /
--     company_name metadata)
--  H) Transactional RPCs (SECURITY DEFINER, service_role only):
--     accept_org_invite, remove_org_member, accept_org_link, unlink_org,
--     convert_org_to_company, transfer_org_ownership
--
-- NOT included (deliberate): profile_preferences.active_org_id — dropped
-- from the design 2026-09-25: with one org per person the write context is
-- always their own org, so no active-org preference exists.
--
-- Additive and idempotent (IF NOT EXISTS / OR REPLACE / ON CONFLICT /
-- guarded UPDATEs). Wrapped in BEGIN/COMMIT. Run the PREFLIGHT block first
-- (read-only), and run this whole file on a Supabase branch before
-- production. Regenerate database.types.ts (api + CropWatch) after.
-- Rollback: commented block at the very bottom.
-- =============================================================================

-- =============================================================================
-- PREFLIGHT (read-only — run alone first, keep the output)
-- =============================================================================
-- -- 1. Locations with no owner (their org comes from the earliest Admin grant;
-- --    anything still unresolved is listed by the OPS footer after the run):
-- SELECT location_id, name FROM public.cw_locations WHERE owner_id IS NULL;
-- -- 2. Devices whose implicit owner differs from their location's owner
-- --    (each gets an explicit legacy Admin override in cw_device_owners):
-- SELECT d.dev_eui, d.name, d.user_id AS device_owner, l.owner_id AS location_owner
--   FROM public.cw_devices d
--   JOIN public.cw_locations l ON l.location_id = d.location_id
--  WHERE d.user_id IS NOT NULL AND l.owner_id IS NOT NULL AND d.user_id <> l.owner_id;
-- -- 3. Devices with neither a location nor an owner (org_id stays NULL):
-- SELECT dev_eui, name FROM public.cw_devices WHERE location_id IS NULL AND user_id IS NULL;
-- -- 4. Billing rows (each maps to its user's home org):
-- SELECT user_id, billing_mode, device_seats FROM public.billing_customers;
-- -- 5. Duplicate (location_id, user_id) grant rows (deduped by this script,
-- --    keeping the strongest level):
-- SELECT location_id, user_id, COUNT(*), MIN(permission_level) AS kept_level
--   FROM public.cw_location_owners
--  GROUP BY 1, 2 HAVING COUNT(*) > 1;
-- -- 6. Legacy Admin/Manager shares (kept + marked legacy until staff convert
-- --    those accounts to companies):
-- SELECT COUNT(*) FROM public.cw_location_owners lo
--   JOIN public.cw_locations l ON l.location_id = lo.location_id
--  WHERE lo.permission_level <= 2
--    AND (l.owner_id IS NULL OR l.owner_id <> lo.user_id);
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A) Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type             text        NOT NULL CHECK (type IN ('personal', 'company')),
  name             text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  -- Which user this org is the personal "home" of. Unique among ACTIVE orgs
  -- only: a deactivated home org stays behind when its owner joins a company
  -- and a fresh one is created when they leave. ON DELETE SET NULL: deleting
  -- a profile must never cascade into org (and thence resource) rows — an
  -- orphaned org is cleaned up by the API's account-removal flow (PR-B).
  home_of_user_id  uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  -- Sub-org link (one level in v1; enforced by trigger below).
  parent_org_id    uuid        REFERENCES public.organizations (id) ON DELETE SET NULL,
  parent_linked_at timestamptz,
  parent_linked_by uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  -- Personal org parked when its owner joins a company (single-org rule).
  deactivated_at   timestamptz,
  converted_at     timestamptz,
  converted_by     uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_org_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_home_of_user_active_key
  ON public.organizations (home_of_user_id)
  WHERE deactivated_at IS NULL AND home_of_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS organizations_parent_org_idx
  ON public.organizations (parent_org_id) WHERE parent_org_id IS NOT NULL;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organizations IS
  'Every account is an organization: personal (one full member) or company. A deactivated row is a personal org parked when its owner joined a company.';

CREATE TABLE IF NOT EXISTS public.organization_members (
  org_id       uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  role         text        NOT NULL CHECK (role IN ('owner', 'manager', 'member', 'guest')),
  status       text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  suspended_at timestamptz,
  suspended_by uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  -- Optional access expiry — guests only.
  expires_at   timestamptz CHECK (expires_at IS NULL OR role = 'guest'),
  invited_by   uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

-- Exactly one owner per organization.
CREATE UNIQUE INDEX IF NOT EXISTS organization_members_one_owner_key
  ON public.organization_members (org_id) WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS organization_members_user_idx
  ON public.organization_members (user_id);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organization_members IS
  'Org membership. owner/manager/member = full membership (at most one ACTIVE org per person, trigger-enforced); guest = view-only, unlimited. Suspension keeps role and grants.';

CREATE TABLE IF NOT EXISTS public.organization_invites (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  email             text        NOT NULL,
  -- sha256 hex of the raw 32-byte token; the raw token is never stored.
  token_hash        text        NOT NULL UNIQUE,
  role              text        NOT NULL CHECK (role IN ('manager', 'member', 'guest')),
  -- [{"location_id": 123, "default_role": 3}] applied on accept.
  location_grants   jsonb,
  -- Optional guest access expiry, copied to organization_members.expires_at.
  member_expires_at timestamptz,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by        uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  expires_at        timestamptz NOT NULL,
  accepted_by       uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  accepted_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_invites_pending_email_key
  ON public.organization_invites (org_id, lower(email)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS organization_invites_org_idx
  ON public.organization_invites (org_id);

ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.organization_link_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_org_id uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  child_org_id  uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  requested_by  uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  decided_by    uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  CHECK (parent_org_id <> child_org_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_link_requests_pending_key
  ON public.organization_link_requests (parent_org_id, child_org_id)
  WHERE status = 'pending';

ALTER TABLE public.organization_link_requests ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- B) org_id + legacy-marker columns on existing tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.cw_locations
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations (id);
ALTER TABLE public.cw_devices
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations (id);
ALTER TABLE public.billing_customers
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations (id);
ALTER TABLE public.device_licenses
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations (id);
ALTER TABLE public.cw_report_templates
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations (id);

-- Pre-migration Admin/Manager shares (levels 1-2) are grandfathered until
-- staff convert those accounts to companies; the new model retires levels
-- 1-2 as grants (Manager becomes an org role).
ALTER TABLE public.cw_location_owners
  ADD COLUMN IF NOT EXISTS is_legacy boolean NOT NULL DEFAULT false;
ALTER TABLE public.cw_device_owners
  ADD COLUMN IF NOT EXISTS is_legacy boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS cw_locations_org_idx ON public.cw_locations (org_id);
CREATE INDEX IF NOT EXISTS cw_devices_org_idx   ON public.cw_devices (org_id);

COMMENT ON COLUMN public.cw_location_owners.is_legacy IS
  'Pre-organizations grant kept at its old meaning (level 1-2 = Admin/Manager). Retired when staff convert the account to a company.';
COMMENT ON COLUMN public.cw_device_owners.is_legacy IS
  'Pre-organizations grant / normalized implicit-owner row kept at its old meaning.';

-- ---------------------------------------------------------------------------
-- C) Missing uniqueness on cw_location_owners(location_id, user_id).
--    The API has always upserted with onConflict:'location_id,user_id' —
--    dedupe (keep the strongest level, lowest id wins ties) and add it.
-- ---------------------------------------------------------------------------
DELETE FROM public.cw_location_owners lo
 USING public.cw_location_owners keep
WHERE keep.location_id = lo.location_id
  AND keep.user_id = lo.user_id
  AND keep.id <> lo.id
  AND (COALESCE(keep.permission_level, 5), keep.id)
    < (COALESCE(lo.permission_level, 5), lo.id);

CREATE UNIQUE INDEX IF NOT EXISTS cw_location_owners_location_user_key
  ON public.cw_location_owners (location_id, user_id);

-- ---------------------------------------------------------------------------
-- D) Invariant triggers
-- ---------------------------------------------------------------------------

-- D1) organizations: one level of nesting; company→personal only when the
--     org has exactly one full member.
CREATE OR REPLACE FUNCTION public.org_check_organization() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.parent_org_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM organizations p
                WHERE p.id = NEW.parent_org_id AND p.parent_org_id IS NOT NULL) THEN
      RAISE EXCEPTION 'ORG_NESTING: the parent organization is itself a child (one level only)';
    END IF;
    IF EXISTS (SELECT 1 FROM organizations c WHERE c.parent_org_id = NEW.id) THEN
      RAISE EXCEPTION 'ORG_NESTING: an organization with children cannot get a parent (one level only)';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.type = 'company' AND NEW.type = 'personal' THEN
    IF (SELECT COUNT(*) FROM organization_members m
         WHERE m.org_id = NEW.id AND m.role IN ('owner', 'manager', 'member')) <> 1 THEN
      RAISE EXCEPTION 'ORG_DOWNGRADE: a company can become personal only with exactly one full member';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_check_organization ON public.organizations;
CREATE TRIGGER org_check_organization
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.org_check_organization();

-- D2) organization_members: single active full membership; owner never
--     suspended; personal orgs hold only their owner plus guests.
CREATE OR REPLACE FUNCTION public.org_check_member() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_org organizations%ROWTYPE;
BEGIN
  SELECT * INTO v_org FROM organizations WHERE id = NEW.org_id;

  IF NEW.role = 'owner' AND NEW.status = 'suspended' THEN
    RAISE EXCEPTION 'ORG_MEMBER: the owner cannot be suspended';
  END IF;

  IF v_org.type = 'personal' AND NEW.role IN ('manager', 'member') THEN
    RAISE EXCEPTION 'ORG_MEMBER: a personal organization has no managers or members — upgrade it to a company';
  END IF;

  -- One active full membership per person, across all ACTIVE organizations.
  -- (Trigger, not a unique index: rows inside deactivated orgs must not count.)
  IF NEW.role IN ('owner', 'manager', 'member') AND v_org.deactivated_at IS NULL THEN
    IF EXISTS (
      SELECT 1
        FROM organization_members m
        JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = NEW.user_id
         AND m.org_id <> NEW.org_id
         AND m.role IN ('owner', 'manager', 'member')
         AND o.deactivated_at IS NULL
    ) THEN
      RAISE EXCEPTION 'ORG_MEMBER: % already holds full membership in another active organization', NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_check_member ON public.organization_members;
CREATE TRIGGER org_check_member
  BEFORE INSERT OR UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.org_check_member();

-- D3) A COMPANY owner's row cannot be deleted while the org still exists and
--     has other full members (ownership goes through transfer_org_ownership).
--     Personal orgs and solo companies are deliberately NOT protected: the
--     account-deletion flow cascade-deletes membership rows via the
--     profiles FK, and that must keep working. (ON DELETE CASCADE from the
--     organizations row also works — the org row is gone first.)
CREATE OR REPLACE FUNCTION public.org_protect_owner_row() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.role = 'owner'
     AND EXISTS (SELECT 1 FROM organizations o
                  WHERE o.id = OLD.org_id AND o.type = 'company')
     AND EXISTS (SELECT 1 FROM organization_members m
                  WHERE m.org_id = OLD.org_id
                    AND m.user_id <> OLD.user_id
                    AND m.role IN ('manager', 'member')) THEN
    RAISE EXCEPTION 'ORG_MEMBER: the owner row cannot be deleted while the company has members — transfer ownership first';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS org_protect_owner_row ON public.organization_members;
CREATE TRIGGER org_protect_owner_row
  BEFORE DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.org_protect_owner_row();

-- D4) Guest grants are capped at Viewer (4) on both grant tables. Users with
--     no membership in the resource's org (today's cross-account shares) are
--     untouched, so the currently deployed API keeps working.
CREATE OR REPLACE FUNCTION public.org_cap_guest_location_grant() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF COALESCE(NEW.permission_level, 5) < 4 AND EXISTS (
    SELECT 1
      FROM cw_locations l
      JOIN organization_members m ON m.org_id = l.org_id
     WHERE l.location_id = NEW.location_id
       AND m.user_id = NEW.user_id
       AND m.role = 'guest'
  ) THEN
    RAISE EXCEPTION 'ORG_GUEST_CAP: guests are capped at Viewer (4)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_cap_guest_location_grant ON public.cw_location_owners;
CREATE TRIGGER org_cap_guest_location_grant
  BEFORE INSERT OR UPDATE ON public.cw_location_owners
  FOR EACH ROW EXECUTE FUNCTION public.org_cap_guest_location_grant();

CREATE OR REPLACE FUNCTION public.org_cap_guest_device_grant() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF COALESCE(NEW.permission_level, 5) < 4 AND EXISTS (
    SELECT 1
      FROM cw_devices d
      JOIN organization_members m ON m.org_id = d.org_id
     WHERE d.dev_eui = NEW.dev_eui
       AND m.user_id = NEW.user_id
       AND m.role = 'guest'
  ) THEN
    RAISE EXCEPTION 'ORG_GUEST_CAP: guests are capped at Viewer (4)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_cap_guest_device_grant ON public.cw_device_owners;
CREATE TRIGGER org_cap_guest_device_grant
  BEFORE INSERT OR UPDATE ON public.cw_device_owners
  FOR EACH ROW EXECUTE FUNCTION public.org_cap_guest_device_grant();

-- ---------------------------------------------------------------------------
-- E) Backfill
-- ---------------------------------------------------------------------------

-- E1) One active Personal "home" org per profile + its owner membership.
INSERT INTO public.organizations (type, name, home_of_user_id)
SELECT
  'personal',
  LEFT(COALESCE(NULLIF(TRIM(p.full_name), ''),
                NULLIF(TRIM(p.username), ''),
                NULLIF(TRIM(p.email), ''),
                'Personal account'), 120),
  p.id
FROM public.profiles p
ON CONFLICT (home_of_user_id) WHERE deactivated_at IS NULL AND home_of_user_id IS NOT NULL
DO NOTHING;

INSERT INTO public.organization_members (org_id, user_id, role)
SELECT o.id, o.home_of_user_id, 'owner'
FROM public.organizations o
WHERE o.home_of_user_id IS NOT NULL
  AND o.deactivated_at IS NULL
ON CONFLICT (org_id, user_id) DO NOTHING;

-- E2) cw_locations.org_id — the owner's home org; when owner_id is NULL,
--     fall back to the earliest Admin (level 1) grant's home org.
UPDATE public.cw_locations l
   SET org_id = o.id
  FROM public.organizations o
 WHERE l.org_id IS NULL
   AND l.owner_id IS NOT NULL
   AND o.home_of_user_id = l.owner_id
   AND o.deactivated_at IS NULL;

UPDATE public.cw_locations l
   SET org_id = o.id
  FROM (
         SELECT DISTINCT ON (lo.location_id) lo.location_id, lo.user_id
           FROM public.cw_location_owners lo
          WHERE lo.permission_level = 1
          ORDER BY lo.location_id, lo.id
       ) first_admin
  JOIN public.organizations o
    ON o.home_of_user_id = first_admin.user_id AND o.deactivated_at IS NULL
 WHERE l.org_id IS NULL
   AND l.owner_id IS NULL
   AND first_admin.location_id = l.location_id;

-- E3) cw_devices.org_id — from the location, else from the implicit owner.
UPDATE public.cw_devices d
   SET org_id = l.org_id
  FROM public.cw_locations l
 WHERE d.org_id IS NULL
   AND d.location_id = l.location_id
   AND l.org_id IS NOT NULL;

UPDATE public.cw_devices d
   SET org_id = o.id
  FROM public.organizations o
 WHERE d.org_id IS NULL
   AND d.user_id IS NOT NULL
   AND o.home_of_user_id = d.user_id
   AND o.deactivated_at IS NULL;

-- E4) Billing, licenses, report templates — the user's home org.
UPDATE public.billing_customers b
   SET org_id = o.id
  FROM public.organizations o
 WHERE b.org_id IS NULL
   AND o.home_of_user_id = b.user_id
   AND o.deactivated_at IS NULL;

UPDATE public.device_licenses dl
   SET org_id = o.id
  FROM public.organizations o
 WHERE dl.org_id IS NULL
   AND o.home_of_user_id = dl.user_id
   AND o.deactivated_at IS NULL;

UPDATE public.cw_report_templates rt
   SET org_id = o.id
  FROM public.organizations o
 WHERE rt.org_id IS NULL
   AND rt.created_by IS NOT NULL
   AND o.home_of_user_id = rt.created_by
   AND o.deactivated_at IS NULL;

-- E5) Mark pre-migration Admin/Manager grants legacy (grandfathered).
UPDATE public.cw_location_owners lo
   SET is_legacy = true
  FROM public.cw_locations l
 WHERE l.location_id = lo.location_id
   AND lo.permission_level <= 2
   AND NOT lo.is_legacy
   AND (l.owner_id IS NULL OR l.owner_id <> lo.user_id);

UPDATE public.cw_device_owners dw
   SET is_legacy = true
  FROM public.cw_devices d
 WHERE d.dev_eui = dw.dev_eui
   AND dw.permission_level <= 2
   AND NOT dw.is_legacy
   AND (d.user_id IS NULL OR d.user_id <> dw.user_id);

-- E6) Normalize implicit device owners: where cw_devices.user_id is not the
--     org's owner, give them an explicit Admin override so nothing is lost
--     when implicit ownership goes away in PR-B.
INSERT INTO public.cw_device_owners (dev_eui, user_id, permission_level, is_legacy)
SELECT d.dev_eui, d.user_id, 1, true
  FROM public.cw_devices d
  JOIN public.organizations o ON o.id = d.org_id
 WHERE d.user_id IS NOT NULL
   AND o.home_of_user_id IS DISTINCT FROM d.user_id
ON CONFLICT (dev_eui, user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- F) Compatibility triggers — the deployed (org-unaware) API keeps producing
--    consistent rows until PR-B. Location→device propagation is permanent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_home_of(p_user uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$
  SELECT id FROM organizations
   WHERE home_of_user_id = p_user AND deactivated_at IS NULL
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.org_fill_location_org() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.org_id IS NULL AND NEW.owner_id IS NOT NULL THEN
    NEW.org_id := public.org_home_of(NEW.owner_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_fill_location_org ON public.cw_locations;
CREATE TRIGGER org_fill_location_org
  BEFORE INSERT ON public.cw_locations
  FOR EACH ROW EXECUTE FUNCTION public.org_fill_location_org();

CREATE OR REPLACE FUNCTION public.org_fill_device_org() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_loc_org uuid;
BEGIN
  -- A device always belongs to its location's org (permanent rule).
  IF NEW.location_id IS NOT NULL THEN
    SELECT org_id INTO v_loc_org FROM cw_locations WHERE location_id = NEW.location_id;
    IF v_loc_org IS NOT NULL THEN
      NEW.org_id := v_loc_org;
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.org_id IS NULL AND NEW.user_id IS NOT NULL THEN
    NEW.org_id := public.org_home_of(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_fill_device_org ON public.cw_devices;
CREATE TRIGGER org_fill_device_org
  BEFORE INSERT OR UPDATE OF location_id ON public.cw_devices
  FOR EACH ROW EXECUTE FUNCTION public.org_fill_device_org();

CREATE OR REPLACE FUNCTION public.org_fill_user_keyed_org() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.org_id IS NULL AND NEW.user_id IS NOT NULL THEN
    NEW.org_id := public.org_home_of(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_fill_billing_org ON public.billing_customers;
CREATE TRIGGER org_fill_billing_org
  BEFORE INSERT ON public.billing_customers
  FOR EACH ROW EXECUTE FUNCTION public.org_fill_user_keyed_org();

DROP TRIGGER IF EXISTS org_fill_license_org ON public.device_licenses;
CREATE TRIGGER org_fill_license_org
  BEFORE INSERT ON public.device_licenses
  FOR EACH ROW EXECUTE FUNCTION public.org_fill_user_keyed_org();

CREATE OR REPLACE FUNCTION public.org_fill_report_template_org() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.org_id IS NULL AND NEW.created_by IS NOT NULL THEN
    NEW.org_id := public.org_home_of(NEW.created_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_fill_report_template_org ON public.cw_report_templates;
CREATE TRIGGER org_fill_report_template_org
  BEFORE INSERT ON public.cw_report_templates
  FOR EACH ROW EXECUTE FUNCTION public.org_fill_report_template_org();

-- ---------------------------------------------------------------------------
-- G) handle_new_user() — full 021 body + home-org creation. Reads
--    account_type ('personal' | 'company') and company_name metadata; every
--    signup gets a home org (invited users too — theirs is empty and is
--    deactivated the moment they accept a company invite).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_org_type text;
  v_org_name text;
  v_org_id   uuid;
BEGIN
  INSERT INTO public.profiles (
    id, username, full_name, employer, avatar_url, email, created_at
  )
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'username',
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NULLIF(TRIM(CONCAT_WS(' ',
        NEW.raw_user_meta_data->>'first_name',
        NEW.raw_user_meta_data->>'last_name')), '')
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'employer',
      NEW.raw_user_meta_data->>'company'
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    COALESCE(NEW.raw_user_meta_data->>'email', NEW.email),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.profiles.email);

  INSERT INTO public.profile_legal_acceptances (user_id, kind, version)
  SELECT NEW.id, cv.kind, cv.version
  FROM (
    SELECT DISTINCT ON (kind) kind, version
    FROM public.legal_document_versions
    WHERE effective_at <= now()
    ORDER BY kind, version DESC
  ) cv
  WHERE (cv.kind = 'privacy_policy'   AND NEW.raw_user_meta_data->>'agreed_privacy' = 'true')
     OR (cv.kind = 'terms_of_service' AND NEW.raw_user_meta_data->>'agreed_terms'   = 'true')
     OR (cv.kind = 'eula'             AND NEW.raw_user_meta_data->>'agreed_eula'    = 'true')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.profile_whats_new_seen (user_id, release)
  SELECT NEW.id, wn.current_release
  FROM public.whats_new wn
  WHERE wn.key = 'app'
  ON CONFLICT DO NOTHING;

  -- 025: every user gets a home organization.
  v_org_type := CASE
    WHEN NEW.raw_user_meta_data->>'account_type' = 'company' THEN 'company'
    ELSE 'personal'
  END;
  v_org_name := LEFT(COALESCE(
    CASE WHEN v_org_type = 'company'
         THEN NULLIF(TRIM(NEW.raw_user_meta_data->>'company_name'), '') END,
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(CONCAT_WS(' ',
      NEW.raw_user_meta_data->>'first_name',
      NEW.raw_user_meta_data->>'last_name')), ''),
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'email', NEW.email)), ''),
    'Personal account'), 120);

  INSERT INTO public.organizations (type, name, home_of_user_id)
  VALUES (v_org_type, v_org_name, NEW.id)
  ON CONFLICT (home_of_user_id) WHERE deactivated_at IS NULL AND home_of_user_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_org_id;

  IF v_org_id IS NOT NULL THEN
    INSERT INTO public.organization_members (org_id, user_id, role)
    VALUES (v_org_id, NEW.id, 'owner')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- H) Transactional RPCs (SECURITY DEFINER; EXECUTE locked to service_role)
-- ---------------------------------------------------------------------------

-- H1) accept_org_invite: locks the invite, enforces the single-org rule and
--     the empty-personal-org rule, deactivates the personal org, adds the
--     member, applies location grants — one transaction.
CREATE OR REPLACE FUNCTION public.accept_org_invite(
  p_token_hash text,
  p_user_id    uuid
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_invite     organization_invites%ROWTYPE;
  v_org        organizations%ROWTYPE;
  v_email      text;
  v_home_org   organizations%ROWTYPE;
  v_grant      jsonb;
  v_level      numeric;
  v_loc_id     bigint;
BEGIN
  SELECT * INTO v_invite
    FROM organization_invites
   WHERE token_hash = p_token_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITE_NOT_FOUND';
  END IF;
  IF v_invite.status <> 'pending' THEN
    -- Accepting twice is idempotent for the same user.
    IF v_invite.status = 'accepted' AND v_invite.accepted_by = p_user_id THEN
      RETURN jsonb_build_object('org_id', v_invite.org_id, 'role', v_invite.role,
                                'already_accepted', true);
    END IF;
    RAISE EXCEPTION 'INVITE_NOT_PENDING: %', v_invite.status;
  END IF;
  IF v_invite.expires_at <= now() THEN
    UPDATE organization_invites SET status = 'expired' WHERE id = v_invite.id;
    RAISE EXCEPTION 'INVITE_EXPIRED';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_invite.org_id;
  IF v_org.deactivated_at IS NOT NULL THEN
    RAISE EXCEPTION 'ORG_DEACTIVATED';
  END IF;
  IF v_org.type = 'personal' AND v_invite.role <> 'guest' THEN
    RAISE EXCEPTION 'PERSONAL_ORG_INVITE: personal organizations only take guests';
  END IF;

  SELECT lower(TRIM(email)) INTO v_email FROM profiles WHERE id = p_user_id;
  IF v_email IS NULL OR v_email <> lower(TRIM(v_invite.email)) THEN
    RAISE EXCEPTION 'INVITE_EMAIL_MISMATCH';
  END IF;

  IF v_invite.role IN ('manager', 'member') THEN
    -- Single-org rule: no other active full membership anywhere.
    IF EXISTS (
      SELECT 1
        FROM organization_members m
        JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = p_user_id
         AND m.role IN ('owner', 'manager', 'member')
         AND o.deactivated_at IS NULL
         AND m.org_id <> v_invite.org_id
         AND (o.home_of_user_id IS DISTINCT FROM p_user_id)  -- their own home org is handled below
    ) THEN
      RAISE EXCEPTION 'ALREADY_FULL_MEMBER: the user already holds full membership in another organization';
    END IF;

    -- Their personal home org must be empty (no locations, devices, seats,
    -- or subscriptions); it is then deactivated.
    SELECT * INTO v_home_org
      FROM organizations
     WHERE home_of_user_id = p_user_id AND deactivated_at IS NULL;

    IF FOUND THEN
      IF v_home_org.type = 'company' THEN
        RAISE EXCEPTION 'ALREADY_FULL_MEMBER: the user owns a company organization';
      END IF;
      IF EXISTS (SELECT 1 FROM cw_locations  WHERE org_id = v_home_org.id)
      OR EXISTS (SELECT 1 FROM cw_devices    WHERE org_id = v_home_org.id)
      OR EXISTS (SELECT 1 FROM device_licenses WHERE user_id = p_user_id)
      OR EXISTS (SELECT 1 FROM billing_customers
                  WHERE user_id = p_user_id
                    AND (device_subscription_id IS NOT NULL
                         OR reporting_subscription_id IS NOT NULL
                         OR device_seats > 0)) THEN
        RAISE EXCEPTION 'PERSONAL_ORG_NOT_EMPTY: move or delete the personal org''s locations, devices, and subscription first';
      END IF;

      UPDATE organizations
         SET deactivated_at = now()
       WHERE id = v_home_org.id;
    END IF;
  END IF;

  INSERT INTO organization_members (org_id, user_id, role, expires_at, invited_by)
  VALUES (
    v_invite.org_id,
    p_user_id,
    v_invite.role,
    CASE WHEN v_invite.role = 'guest' THEN v_invite.member_expires_at END,
    v_invite.invited_by
  )
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        status = 'active',
        expires_at = EXCLUDED.expires_at;

  -- Location grants: only locations that belong to the inviting org; guests
  -- are clamped to Viewer.
  FOR v_grant IN SELECT * FROM jsonb_array_elements(COALESCE(v_invite.location_grants, '[]'::jsonb))
  LOOP
    v_loc_id := (v_grant->>'location_id')::bigint;
    v_level  := (v_grant->>'default_role')::numeric;
    IF v_level IS NULL OR v_level < 1 OR v_level > 5 THEN
      CONTINUE;
    END IF;
    IF v_invite.role = 'guest' THEN
      v_level := GREATEST(v_level, 4);
    END IF;
    IF EXISTS (SELECT 1 FROM cw_locations l
                WHERE l.location_id = v_loc_id AND l.org_id = v_invite.org_id) THEN
      INSERT INTO cw_location_owners
        (location_id, user_id, permission_level, is_active, admin_user_id)
      VALUES (v_loc_id, p_user_id, v_level, true, COALESCE(v_invite.invited_by, p_user_id))
      ON CONFLICT (location_id, user_id) DO UPDATE
        SET permission_level = EXCLUDED.permission_level,
            is_active = true;
    END IF;
  END LOOP;

  UPDATE organization_invites
     SET status = 'accepted', accepted_by = p_user_id, accepted_at = now()
   WHERE id = v_invite.id;

  RETURN jsonb_build_object('org_id', v_invite.org_id, 'role', v_invite.role);
END;
$$;

-- H2) remove_org_member: removal or leave. Wipes the member's grants on the
--     org's resources; a departing FULL member gets a fresh personal org so
--     the account stays usable. The owner cannot be removed.
CREATE OR REPLACE FUNCTION public.remove_org_member(
  p_org_id  uuid,
  p_user_id uuid
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_member organization_members%ROWTYPE;
  v_new_org uuid;
  v_name   text;
BEGIN
  SELECT * INTO v_member
    FROM organization_members
   WHERE org_id = p_org_id AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND';
  END IF;
  IF v_member.role = 'owner' THEN
    RAISE EXCEPTION 'OWNER_CANNOT_LEAVE: transfer ownership first';
  END IF;

  DELETE FROM cw_location_owners lo
   USING cw_locations l
   WHERE l.location_id = lo.location_id
     AND l.org_id = p_org_id
     AND lo.user_id = p_user_id;

  DELETE FROM cw_device_owners dw
   USING cw_devices d
   WHERE d.dev_eui = dw.dev_eui
     AND d.org_id = p_org_id
     AND dw.user_id = p_user_id;

  DELETE FROM organization_members
   WHERE org_id = p_org_id AND user_id = p_user_id;

  -- A departing full member needs a home again (single-org rule guarantees
  -- they have no other active org).
  IF v_member.role IN ('manager', 'member') AND NOT EXISTS (
    SELECT 1 FROM organizations
     WHERE home_of_user_id = p_user_id AND deactivated_at IS NULL
  ) THEN
    SELECT LEFT(COALESCE(NULLIF(TRIM(full_name), ''),
                         NULLIF(TRIM(username), ''),
                         NULLIF(TRIM(email), ''),
                         'Personal account'), 120)
      INTO v_name FROM profiles WHERE id = p_user_id;

    INSERT INTO organizations (type, name, home_of_user_id)
    VALUES ('personal', COALESCE(v_name, 'Personal account'), p_user_id)
    RETURNING id INTO v_new_org;

    INSERT INTO organization_members (org_id, user_id, role)
    VALUES (v_new_org, p_user_id, 'owner');
  END IF;

  RETURN jsonb_build_object('removed_role', v_member.role,
                            'new_personal_org_id', v_new_org);
END;
$$;

-- H3) accept_org_link: the child owner accepts a pending parent-link request.
CREATE OR REPLACE FUNCTION public.accept_org_link(
  p_request_id uuid,
  p_decided_by uuid
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_req organization_link_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req
    FROM organization_link_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND OR v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'LINK_REQUEST_NOT_PENDING';
  END IF;
  IF EXISTS (SELECT 1 FROM organizations
              WHERE id = v_req.child_org_id
                AND (parent_org_id IS NOT NULL OR deactivated_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'CHILD_ALREADY_LINKED';
  END IF;
  IF EXISTS (SELECT 1 FROM organizations
              WHERE id = v_req.parent_org_id AND deactivated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'PARENT_DEACTIVATED';
  END IF;

  -- One level: nesting is re-checked by the organizations trigger on UPDATE.
  UPDATE organizations
     SET parent_org_id = v_req.parent_org_id,
         parent_linked_at = now(),
         parent_linked_by = p_decided_by
   WHERE id = v_req.child_org_id;

  UPDATE organization_link_requests
     SET status = 'accepted', decided_by = p_decided_by, decided_at = now()
   WHERE id = p_request_id;
END;
$$;

-- H4) unlink_org: parent owner or staff only (enforced in the API).
CREATE OR REPLACE FUNCTION public.unlink_org(p_child_org_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE organizations
     SET parent_org_id = NULL,
         parent_linked_at = NULL,
         parent_linked_by = NULL
   WHERE id = p_child_org_id;
END;
$$;

-- H5) convert_org_to_company: same org id, so data and the subscription
--     carry over.
CREATE OR REPLACE FUNCTION public.convert_org_to_company(
  p_org_id       uuid,
  p_name         text,
  p_converted_by uuid
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE organizations
     SET type = 'company',
         name = COALESCE(LEFT(NULLIF(TRIM(p_name), ''), 120), name),
         converted_at = now(),
         converted_by = p_converted_by
   WHERE id = p_org_id
     AND type = 'personal'
     AND deactivated_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONVERT_FAILED: org missing, deactivated, or already a company';
  END IF;
END;
$$;

-- H6) transfer_org_ownership (staff tool, companies only): swaps the owner
--     and rewrites the legacy owner_id / user_id mirrors.
CREATE OR REPLACE FUNCTION public.transfer_org_ownership(
  p_org_id    uuid,
  p_new_owner uuid
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_old_owner uuid;
BEGIN
  SELECT * INTO v_org FROM organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND OR v_org.deactivated_at IS NOT NULL THEN
    RAISE EXCEPTION 'ORG_NOT_FOUND_OR_DEACTIVATED';
  END IF;
  IF v_org.type <> 'company' THEN
    RAISE EXCEPTION 'TRANSFER_PERSONAL: a personal org cannot be transferred — convert it to a company first';
  END IF;

  SELECT user_id INTO v_old_owner
    FROM organization_members
   WHERE org_id = p_org_id AND role = 'owner'
   FOR UPDATE;

  IF v_old_owner IS NULL THEN
    RAISE EXCEPTION 'NO_CURRENT_OWNER';
  END IF;
  IF v_old_owner = p_new_owner THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
     WHERE org_id = p_org_id AND user_id = p_new_owner
       AND role IN ('manager', 'member') AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'NEW_OWNER_NOT_FULL_MEMBER: the new owner must already be an active manager or member of the org';
  END IF;

  UPDATE organization_members SET role = 'manager'
   WHERE org_id = p_org_id AND user_id = v_old_owner;
  UPDATE organization_members SET role = 'owner', status = 'active'
   WHERE org_id = p_org_id AND user_id = p_new_owner;

  -- Legacy implicit-ownership mirrors follow the owner.
  UPDATE cw_locations SET owner_id = p_new_owner
   WHERE org_id = p_org_id AND owner_id = v_old_owner;
  UPDATE cw_devices SET user_id = p_new_owner
   WHERE org_id = p_org_id AND user_id = v_old_owner;

  UPDATE organizations SET updated_at = now() WHERE id = p_org_id;
END;
$$;

-- Lock every 025 function to the service role (005 convention).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.org_check_organization()',
    'public.org_check_member()',
    'public.org_protect_owner_row()',
    'public.org_cap_guest_location_grant()',
    'public.org_cap_guest_device_grant()',
    'public.org_home_of(uuid)',
    'public.org_fill_location_org()',
    'public.org_fill_device_org()',
    'public.org_fill_user_keyed_org()',
    'public.org_fill_report_template_org()',
    'public.accept_org_invite(text, uuid)',
    'public.remove_org_member(uuid, uuid)',
    'public.accept_org_link(uuid, uuid)',
    'public.unlink_org(uuid)',
    'public.convert_org_to_company(uuid, text, uuid)',
    'public.transfer_org_ownership(uuid, uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- OPS — verification (read-only, run right after COMMIT; keep the output)
-- =============================================================================
-- -- V1. Every profile has exactly one active home org (expect: total = profiles,
-- --     dupes = 0, missing = 0):
-- SELECT
--   (SELECT COUNT(*) FROM public.profiles)                                        AS profiles,
--   (SELECT COUNT(*) FROM public.organizations
--     WHERE deactivated_at IS NULL AND home_of_user_id IS NOT NULL)               AS active_home_orgs,
--   (SELECT COUNT(*) FROM public.profiles p
--     WHERE NOT EXISTS (SELECT 1 FROM public.organizations o
--       WHERE o.home_of_user_id = p.id AND o.deactivated_at IS NULL))             AS profiles_missing_home_org;
-- -- V2. Every active org has exactly one owner membership (expect 0):
-- SELECT COUNT(*) AS orgs_without_owner FROM public.organizations o
--  WHERE o.deactivated_at IS NULL
--    AND NOT EXISTS (SELECT 1 FROM public.organization_members m
--                     WHERE m.org_id = o.id AND m.role = 'owner');
-- -- V3. org_id coverage (locations/billing/licenses expect 0; devices with
-- --     neither location nor owner may legitimately stay NULL — compare with
-- --     preflight #3):
-- SELECT
--   (SELECT COUNT(*) FROM public.cw_locations      WHERE org_id IS NULL) AS locations_null_org,
--   (SELECT COUNT(*) FROM public.cw_devices        WHERE org_id IS NULL) AS devices_null_org,
--   (SELECT COUNT(*) FROM public.billing_customers WHERE org_id IS NULL) AS billing_null_org,
--   (SELECT COUNT(*) FROM public.device_licenses   WHERE org_id IS NULL) AS licenses_null_org,
--   (SELECT COUNT(*) FROM public.cw_report_templates WHERE org_id IS NULL) AS report_templates_null_org;
-- -- V3b. List any unresolved locations (staff follow-up):
-- SELECT location_id, name FROM public.cw_locations WHERE org_id IS NULL;
-- -- V4. Legacy markers + normalized implicit owners (compare with preflight
-- --     #2 and #6):
-- SELECT
--   (SELECT COUNT(*) FROM public.cw_location_owners WHERE is_legacy) AS legacy_location_grants,
--   (SELECT COUNT(*) FROM public.cw_device_owners   WHERE is_legacy) AS legacy_device_grants;
-- -- V5. Grant-table uniqueness landed (expect one row):
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname = 'public' AND indexname = 'cw_location_owners_location_user_key';
-- -- V6. Compatibility smoke test — a location inserted by the OLD API gets an
-- --     org automatically (run as one transaction, then roll back):
-- -- BEGIN;
-- -- INSERT INTO public.cw_locations (name, owner_id)
-- --   SELECT 'org-compat-smoke', id FROM public.profiles LIMIT 1;
-- -- SELECT org_id IS NOT NULL AS filled FROM public.cw_locations WHERE name = 'org-compat-smoke';
-- -- ROLLBACK;
-- =============================================================================
-- ROLLBACK (last resort — reverses everything 025 added; org data is LOST)
-- =============================================================================
-- BEGIN;
-- DROP TRIGGER IF EXISTS org_fill_location_org        ON public.cw_locations;
-- DROP TRIGGER IF EXISTS org_fill_device_org          ON public.cw_devices;
-- DROP TRIGGER IF EXISTS org_fill_billing_org         ON public.billing_customers;
-- DROP TRIGGER IF EXISTS org_fill_license_org         ON public.device_licenses;
-- DROP TRIGGER IF EXISTS org_fill_report_template_org ON public.cw_report_templates;
-- DROP TRIGGER IF EXISTS org_cap_guest_location_grant ON public.cw_location_owners;
-- DROP TRIGGER IF EXISTS org_cap_guest_device_grant   ON public.cw_device_owners;
-- DROP FUNCTION IF EXISTS public.accept_org_invite(text, uuid);
-- DROP FUNCTION IF EXISTS public.remove_org_member(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.accept_org_link(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.unlink_org(uuid);
-- DROP FUNCTION IF EXISTS public.convert_org_to_company(uuid, text, uuid);
-- DROP FUNCTION IF EXISTS public.transfer_org_ownership(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.org_fill_location_org();
-- DROP FUNCTION IF EXISTS public.org_fill_device_org();
-- DROP FUNCTION IF EXISTS public.org_fill_user_keyed_org();
-- DROP FUNCTION IF EXISTS public.org_fill_report_template_org();
-- DROP FUNCTION IF EXISTS public.org_cap_guest_location_grant();
-- DROP FUNCTION IF EXISTS public.org_cap_guest_device_grant();
-- DROP FUNCTION IF EXISTS public.org_home_of(uuid);
-- -- restore the 021 handle_new_user() body from 021_scheduled_legal_updates.sql
-- ALTER TABLE public.cw_locations        DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.cw_devices          DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.billing_customers   DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.device_licenses     DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.cw_report_templates DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.cw_location_owners  DROP COLUMN IF EXISTS is_legacy;
-- ALTER TABLE public.cw_device_owners    DROP COLUMN IF EXISTS is_legacy;
-- -- keep cw_location_owners_location_user_key: it fixes a latent upsert bug
-- DROP TABLE IF EXISTS public.organization_link_requests;
-- DROP TABLE IF EXISTS public.organization_invites;
-- DROP TABLE IF EXISTS public.organization_members;
-- DROP TABLE IF EXISTS public.organizations;
-- DROP FUNCTION IF EXISTS public.org_check_organization();
-- DROP FUNCTION IF EXISTS public.org_check_member();
-- DROP FUNCTION IF EXISTS public.org_protect_owner_row();
-- COMMIT;

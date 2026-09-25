/**
 * The one policy table for the v1 API.
 *
 * Access reaches a resource through four doors, tried in order
 * (docs/permission-model.md + plan section 4.6):
 *
 *   1. staff             — everything, everywhere
 *   2. org role          — owner: everything in their org;
 *                          manager: everything except the OWNER_ONLY set
 *   3. parent link       — owner/manager of a parent org: read+download
 *                          on child-org resources
 *   4. grants            — per-resource permission level vs POLICY_CEILINGS
 *                          (legacy levels 1-2 are grandfathered pre-org
 *                          Admin/Manager shares; new grants are 3-5)
 *
 * The implicit resource owner (cw_locations.owner_id / cw_devices.user_id)
 * still outranks everything for back-compat with pre-org accounts.
 */
import { PermissionLevel } from '../permission-levels';
import { Action } from './actions';

/**
 * Inclusive grant-level ceiling per action: the grant door opens when
 * `level <= ceiling`. 0 = no grant path (org-role door only).
 */
export const POLICY_CEILINGS: Readonly<Record<Action, number>> = {
  [Action.LocationRead]: PermissionLevel.VIEWER,
  [Action.LocationEdit]: PermissionLevel.MANAGER,
  [Action.LocationGrant]: PermissionLevel.MANAGER,
  [Action.LocationDeviceCreate]: PermissionLevel.MANAGER,
  [Action.LocationCreate]: 0,
  [Action.LocationDelete]: 0,

  [Action.DeviceRead]: PermissionLevel.VIEWER,
  [Action.DeviceEdit]: PermissionLevel.MANAGER,
  [Action.DeviceGrant]: PermissionLevel.ADMIN,
  [Action.DeviceReplace]: PermissionLevel.ADMIN,

  [Action.DataRead]: PermissionLevel.VIEWER,
  [Action.NoteWrite]: PermissionLevel.USER,

  [Action.RelayRead]: PermissionLevel.VIEWER,
  [Action.RelayControl]: PermissionLevel.MANAGER,

  [Action.RuleView]: PermissionLevel.VIEWER,
  [Action.RuleManage]: PermissionLevel.MANAGER,

  [Action.ReportView]: PermissionLevel.VIEWER,
  [Action.ReportManage]: PermissionLevel.MANAGER,
  [Action.ReportDownload]: PermissionLevel.VIEWER,

  [Action.GatewayView]: 0,
  [Action.GatewayEdit]: 0,
  [Action.GatewayCreate]: 0,

  [Action.OrgRead]: 0,
  [Action.OrgManageOpen]: 0,
  [Action.OrgSettingsManage]: 0,
  [Action.MemberInvite]: 0,
  [Action.GuestInvite]: 0,
  [Action.BillingManage]: 0,
} as const;

/**
 * Actions an org MANAGER may NOT perform (money and structure are
 * owner-only; plan section 4.2). Everything else in the org is theirs.
 */
export const OWNER_ONLY_ACTIONS: ReadonlySet<Action> = new Set([
  Action.LocationCreate,
  Action.LocationDelete,
  // Owner-only as an ORG action; the level-2 ceiling below still lets
  // grandfathered legacy Admin/Manager grants add devices to their shared
  // locations until staff convert those accounts.
  Action.LocationDeviceCreate,
  Action.DeviceReplace,
  Action.GatewayCreate,
  Action.OrgSettingsManage,
  Action.GuestInvite,
  Action.BillingManage,
]);

/** What a parent org's owner/manager gets on child-org resources. */
export const PARENT_READ_ACTIONS: ReadonlySet<Action> = new Set([
  Action.LocationRead,
  Action.DeviceRead,
  Action.DataRead,
  Action.RelayRead,
  Action.RuleView,
  Action.ReportView,
  Action.ReportDownload,
]);

/** The caller's relationship to one concrete resource. */
export interface AccessSubject {
  /** CropWatch staff (@cropwatch.io) bypass every check. */
  isStaff: boolean;
  /** Implicit owner (cw_locations.owner_id / cw_devices.user_id). */
  isOwner: boolean;
  /** Effective grant level on the resource, or null when none. */
  level: number | null;
  /** The caller's org role when the resource belongs to THEIR org. */
  orgRole?: 'owner' | 'manager' | null;
  /** The resource's org is a child of the caller's org (view+download). */
  parentRead?: boolean;
}

/** Pure decision: may `subject` perform `action` on the resource? */
export function decide(subject: AccessSubject, action: Action): boolean {
  if (subject.isStaff || subject.isOwner) {
    return true;
  }
  if (subject.orgRole === 'owner') {
    return true;
  }
  if (subject.orgRole === 'manager' && !OWNER_ONLY_ACTIONS.has(action)) {
    return true;
  }
  if (subject.parentRead && PARENT_READ_ACTIONS.has(action)) {
    return true;
  }
  return subject.level != null && subject.level <= POLICY_CEILINGS[action];
}

/** Every action `subject` may perform — the app's capability list. */
export function capabilitiesFor(subject: AccessSubject): Action[] {
  return Object.values(Action).filter((action) => decide(subject, action));
}

/**
 * Org-level capabilities from a bare role (no concrete resource): what the
 * app uses to gate the Management area, billing menu, create buttons, etc.
 */
export function orgCapabilitiesFor(
  role: 'owner' | 'manager' | 'member' | 'guest' | null,
): Action[] {
  if (role === 'owner') {
    return Object.values(Action);
  }
  if (role === 'manager') {
    return Object.values(Action).filter((a) => !OWNER_ONLY_ACTIONS.has(a));
  }
  if (role === 'member' || role === 'guest') {
    return [Action.OrgRead];
  }
  return [];
}

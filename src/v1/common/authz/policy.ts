/**
 * The one policy table for the v1 API.
 *
 * Each action maps to the most-permissive (numerically highest) permission
 * level that may perform it. The caller's effective level on the concrete
 * resource comes from `AccessService`; deciding is a pure comparison here.
 *
 * Today's five-level model (docs/permission-model.md):
 *   owner (implicit) > 1 Admin > 2 Manager > 3 User > 4 Viewer > 5 Disabled
 *
 * Staff and the implicit resource owner pass every action.
 */
import { PermissionLevel } from '../permission-levels';
import { Action } from './actions';

/** Inclusive level ceiling per action: allowed when `level <= ceiling`. */
export const POLICY_CEILINGS: Readonly<Record<Action, PermissionLevel>> = {
  [Action.LocationRead]: PermissionLevel.VIEWER,
  [Action.LocationEdit]: PermissionLevel.MANAGER,
  [Action.LocationGrant]: PermissionLevel.MANAGER,
  [Action.LocationDeviceCreate]: PermissionLevel.MANAGER,

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
} as const;

/** The caller's relationship to one concrete resource. */
export interface AccessSubject {
  /** CropWatch staff (@cropwatch.io) bypass every check. */
  isStaff: boolean;
  /** Implicit owner (cw_locations.owner_id / cw_devices.user_id). */
  isOwner: boolean;
  /** The caller's permission level on the resource, or null when none. */
  level: number | null;
}

/** Pure decision: may `subject` perform `action` on the resource? */
export function decide(subject: AccessSubject, action: Action): boolean {
  if (subject.isStaff || subject.isOwner) {
    return true;
  }
  return subject.level != null && subject.level <= POLICY_CEILINGS[action];
}

/** Every action `subject` may perform — the app's capability list. */
export function capabilitiesFor(subject: AccessSubject): Action[] {
  return Object.values(Action).filter((action) => decide(subject, action));
}

export { Action } from './actions';
export {
  POLICY_CEILINGS,
  OWNER_ONLY_ACTIONS,
  PARENT_READ_ACTIONS,
  decide,
  capabilitiesFor,
  orgCapabilitiesFor,
  type AccessSubject,
} from './policy';
export { assertCanGrant, type GrantCheck } from './grant-policy';
export {
  assertCanEditMember,
  assertCanInvite,
  assertCanRemove,
  assertCanSuspend,
  inviteableRoles,
  type OrgRole,
} from './org-role-policy';
export {
  emptyOrgContext,
  orgRoleFor,
  parentReadFor,
  type GuestSeat,
  type OrgContext,
  type OrgStanding,
} from './org-context';
export {
  DEVICE_OWNER_MATCH_EMBED,
  LOCATION_OWNER_MATCH_EMBED,
  applyDeviceReadScope,
  applyDeviceManageScope,
  applyLocationReadScope,
  applyLocationManageScope,
  type ScopedQuery,
} from './scope';
export {
  AccessService,
  type AccessibleDevice,
  type DeviceAccess,
  type LocationAccess,
} from './access.service';
export { OrgOwnerGuard } from './org-owner.guard';
export { AuthzModule } from './authz.module';

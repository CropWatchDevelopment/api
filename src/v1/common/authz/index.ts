export { Action } from './actions';
export {
  POLICY_CEILINGS,
  decide,
  capabilitiesFor,
  type AccessSubject,
} from './policy';
export { assertCanGrant, type GrantCheck } from './grant-policy';
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
export { AuthzModule } from './authz.module';

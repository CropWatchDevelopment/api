/**
 * Every permission-gated action in the v1 API, named centrally so the policy
 * table in `policy.ts` is the single place that maps an action to the access
 * it requires. Services must never compare permission levels inline — they
 * ask `AccessService` / `decide()` about one of these actions instead.
 */
export const Action = {
  /** View a location and its metadata. */
  LocationRead: 'location.read',
  /** Rename / edit a location's own fields. */
  LocationEdit: 'location.edit',
  /** Create, change, or remove another user's access to a location. */
  LocationGrant: 'location.grant',
  /** Add a new device to a location (a location-manage action). */
  LocationDeviceCreate: 'location.device-create',

  /** View a device and its metadata. */
  DeviceRead: 'device.read',
  /** Edit a device's settings (name, group, location move). */
  DeviceEdit: 'device.edit',
  /** Change another user's permission level on a device. */
  DeviceGrant: 'device.grant',
  /** Replace a device with another physical unit. */
  DeviceReplace: 'device.replace',

  /** Read sensor data (air / soil / water / traffic / power). */
  DataRead: 'data.read',
  /** Create, edit, or delete data annotations (notes). */
  NoteWrite: 'note.write',

  /** Read relay state. */
  RelayRead: 'relay.read',
  /** Actuate a relay or schedule relay actions. */
  RelayControl: 'relay.control',

  /** View rules that reference a device. */
  RuleView: 'rule.view',
  /** Create, edit, or delete rules that reference a device. */
  RuleManage: 'rule.manage',

  /** View report templates that reference a device. */
  ReportView: 'report.view',
  /** Create, edit, delete, or regenerate reports for a device. */
  ReportManage: 'report.manage',
  /** Download a generated report / CSV for a device. */
  ReportDownload: 'report.download',
} as const;

export type Action = (typeof Action)[keyof typeof Action];

// The documented API surface, derived directly from the NestJS controllers
// (src/v1/**/*.controller.ts). All paths carry the global /v1 version prefix
// (src/main.ts enables URI versioning with defaultVersion '1').

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface Endpoint {
  method: HttpMethod;
  path: string;
  summary: string;
  params?: string;
}

export interface ResourceGroup {
  id: string;
  name: string;
  blurb: string;
  endpoints: Endpoint[];
}

export const resourceGroups: ResourceGroup[] = [
  {
    id: 'auth',
    name: 'Authentication',
    blurb: 'Exchange credentials for a Supabase JWT, then read your profile.',
    endpoints: [
      {
        method: 'POST',
        path: '/v1/auth/login',
        summary: 'Exchange email + password for a bearer access token.',
        params: 'body: { email, password }',
      },
      {
        method: 'GET',
        path: '/v1/auth/user-profile',
        summary: 'Return the authenticated user’s profile.',
      },
    ],
  },
  {
    id: 'devices',
    name: 'Devices',
    blurb: 'Inventory, status, groups and the raw + latest data records for each device.',
    endpoints: [
      { method: 'GET', path: '/v1/devices', summary: 'List the devices you can access.', params: 'skip, take (≤1000), group, name, location' },
      { method: 'GET', path: '/v1/devices/status', summary: 'Online vs. offline summary across your devices.' },
      { method: 'GET', path: '/v1/devices/groups', summary: 'Distinct device groups.' },
      { method: 'GET', path: '/v1/devices/device-types', summary: 'Device types available to you.' },
      { method: 'GET', path: '/v1/devices/latest-primary-data', summary: 'Latest two primary values for all devices.', params: 'skip, take, name, location, locationGroup' },
      { method: 'GET', path: '/v1/devices/location/{location_id}', summary: 'Latest primary data for every device in a location.' },
      { method: 'GET', path: '/v1/devices/{dev_eui}', summary: 'Get a single device.' },
      { method: 'GET', path: '/v1/devices/{dev_eui}/data', summary: 'Full data records, paginated.', params: 'skip, take' },
      { method: 'GET', path: '/v1/devices/{dev_eui}/data-within-range', summary: 'Full data inside an ISO 8601 time window.', params: 'start, end, skip, take' },
      { method: 'GET', path: '/v1/devices/{dev_eui}/latest-data', summary: 'The single latest full record.' },
      { method: 'PATCH', path: '/v1/devices/{dev_eui}', summary: 'Update a device’s name, group or location.' },
      { method: 'PATCH', path: '/v1/devices/{dev_eui}/permission-level', summary: 'Share a device with another user.' },
    ],
  },
  {
    id: 'telemetry',
    name: 'Telemetry (typed reads)',
    blurb: 'One schema per sensor family. Defaults to the last 24h; pass an ISO 8601 window and an optional IANA timezone.',
    endpoints: [
      { method: 'GET', path: '/v1/air/{dev_eui}', summary: 'Air telemetry — temperature, humidity, CO₂, and more.', params: 'start, end, timezone' },
      { method: 'GET', path: '/v1/soil/{dev_eui}', summary: 'Soil moisture and temperature.', params: 'start, end, timezone' },
      { method: 'GET', path: '/v1/water/{dev_eui}', summary: 'Water level and quality metrics.', params: 'start, end, timezone' },
      { method: 'GET', path: '/v1/power/{dev_eui}', summary: 'Power and energy metrics.', params: 'start, end, timezone' },
      { method: 'GET', path: '/v1/traffic/{dev_eui}', summary: 'Traffic counts and flow metrics.', params: 'start, end, timezone' },
    ],
  },
  {
    id: 'locations',
    name: 'Locations',
    blurb: 'Group devices into sites and manage who can see them.',
    endpoints: [
      { method: 'GET', path: '/v1/locations', summary: 'List your locations.', params: 'name' },
      { method: 'GET', path: '/v1/locations/groups', summary: 'Distinct location groups.' },
      { method: 'GET', path: '/v1/locations/{id}', summary: 'Get a single location.' },
      { method: 'POST', path: '/v1/locations', summary: 'Create a location.' },
      { method: 'PATCH', path: '/v1/locations/{id}', summary: 'Update a location.' },
      { method: 'POST', path: '/v1/locations/{id}/permission', summary: 'Grant a user access to a location.' },
      { method: 'PATCH', path: '/v1/locations/{id}/permission-level', summary: 'Change a user’s permission level.' },
      { method: 'DELETE', path: '/v1/locations/{id}/permission', summary: 'Revoke a user’s access.' },
    ],
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    blurb: 'Pre-rolled aggregates shaped for operations dashboards.',
    endpoints: [
      { method: 'GET', path: '/v1/dashboard/devices', summary: 'Devices rolled up for dashboards.' },
      { method: 'GET', path: '/v1/dashboard/locations', summary: 'Locations rolled up for dashboards.' },
      { method: 'GET', path: '/v1/dashboard/devices/{dev_eui}/latest', summary: 'Latest snapshot for a single device.' },
    ],
  },
  {
    id: 'rules',
    name: 'Automation — Rules',
    blurb: 'Threshold-based rules that fire actions when telemetry crosses a bound.',
    endpoints: [
      { method: 'GET', path: '/v1/rules-new', summary: 'List your rules.' },
      { method: 'GET', path: '/v1/rules-new/action-types', summary: 'Supported action types.' },
      { method: 'GET', path: '/v1/rules-new/form-context', summary: 'Options for building a rule.' },
      { method: 'GET', path: '/v1/rules-new/triggered', summary: 'Recently triggered rules (and /triggered/count).' },
      { method: 'GET', path: '/v1/rules-new/{id}', summary: 'Get a rule (and /{id}/history).' },
      { method: 'POST', path: '/v1/rules-new', summary: 'Create a rule.' },
      { method: 'PATCH', path: '/v1/rules-new/{id}', summary: 'Update a rule.' },
      { method: 'DELETE', path: '/v1/rules-new/{id}', summary: 'Delete a rule.' },
    ],
  },
  {
    id: 'reports',
    name: 'Automation — Reports',
    blurb: 'Scheduled reports with recipients and delivery channels.',
    endpoints: [
      { method: 'GET', path: '/v1/reports-new', summary: 'List scheduled reports.' },
      { method: 'GET', path: '/v1/reports-new/communication-methods', summary: 'Available delivery channels.' },
      { method: 'GET', path: '/v1/reports-new/form-context', summary: 'Options for building a report.' },
      { method: 'GET', path: '/v1/reports-new/download/{dev_eui}/{reportName}', summary: 'Download a generated report.' },
      { method: 'GET', path: '/v1/reports-new/{id}', summary: 'Get a report (and /{id}/history).' },
      { method: 'POST', path: '/v1/reports-new', summary: 'Create a report.' },
      { method: 'PATCH', path: '/v1/reports-new/{id}', summary: 'Update a report.' },
      { method: 'DELETE', path: '/v1/reports-new/{id}', summary: 'Delete a report.' },
    ],
  },
  {
    id: 'gateway',
    name: 'Gateways',
    blurb: 'Read-only view of your LoRaWAN gateways.',
    endpoints: [
      { method: 'GET', path: '/v1/gateway', summary: 'List your gateways.' },
      { method: 'GET', path: '/v1/gateway/{gatewayId}', summary: 'Get a single gateway.' },
    ],
  },
  {
    id: 'relay',
    name: 'Relays (control)',
    blurb: 'Read and command relay-equipped devices.',
    endpoints: [
      { method: 'GET', path: '/v1/relay/{dev_eui}', summary: 'Read the current relay state.' },
      { method: 'PATCH', path: '/v1/relay/{dev_eui}', summary: 'Set the relay state.' },
      { method: 'POST', path: '/v1/relay/{dev_eui}/pulse', summary: 'Pulse the relay for a set duration.' },
    ],
  },
  {
    id: 'payments',
    name: 'Billing (Polar)',
    blurb: 'Subscriptions, device licenses, checkout and the customer portal.',
    endpoints: [
      { method: 'GET', path: '/v1/payments/products', summary: 'Product catalog.' },
      { method: 'GET', path: '/v1/payments/subscriptions/state', summary: 'Your current subscription state.' },
      { method: 'GET', path: '/v1/payments/licenses', summary: 'Your device licenses.' },
      { method: 'POST', path: '/v1/payments/subscriptions/base/checkout', summary: 'Start base-subscription checkout.' },
      { method: 'POST', path: '/v1/payments/subscriptions/device/checkout', summary: 'Start device-license checkout.' },
      { method: 'PATCH', path: '/v1/payments/subscriptions/device/seats', summary: 'Adjust device seats.' },
      { method: 'POST', path: '/v1/payments/licenses/{id}/assign', summary: 'Assign a license to a device (also /move, /unassign, /cancel).' },
      { method: 'POST', path: '/v1/payments/portal', summary: 'Open the customer billing portal.' },
      { method: 'DELETE', path: '/v1/payments/subscriptions/base', summary: 'Cancel the base subscription.' },
    ],
  },
];

export interface Capability {
  title: string;
  body: string;
}

export const capabilities: Capability[] = [
  { title: 'Unified telemetry', body: 'Air, soil, water, power and traffic readings under one schema — query by dev_eui with precise time windows and optional timezone alignment.' },
  { title: 'Devices & locations', body: 'Inventory, online/offline status, latest values and per-user sharing for every device and the sites they belong to.' },
  { title: 'Automation', body: 'Threshold rules that fire actions, plus scheduled reports with recipients and delivery channels.' },
  { title: 'Billing', body: 'Polar-backed subscriptions and device licenses: checkout, seat management and a self-serve customer portal.' },
  { title: 'MCP for AI clients', body: 'A Model Context Protocol server lets Claude, Cursor and other MCP clients call the API as tools — scoped to the caller.' },
  { title: 'Interactive docs', body: 'A full Swagger UI at /docs with live schemas, example responses and tagged operations for every module.' },
];

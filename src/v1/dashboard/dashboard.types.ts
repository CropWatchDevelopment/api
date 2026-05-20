export interface DashboardQuery {
  skip?: number;
  take?: number;
  group?: string;
  name?: string;
  location?: string;
  locationGroup?: string;
}

export interface DashboardRow {
  dev_eui: string;
  name: string;
  group: string | null;
  upload_interval: number | null;
  last_data_updated_at: string | null;

  device_type: {
    id: number;
    name: string;
    data_table_v2: string;
    primary_data_v2: string;
    secondary_data_v2: string;
    default_upload_interval: number | null;
  };

  location: {
    location_id: number;
    name: string;
    group: string | null;
  } | null;

  latest: {
    created_at: string | null;
    primary: number | string | boolean | null;
    secondary: number | string | boolean | null;
  } | null;
}

export interface DashboardPage {
  rows: DashboardRow[];
  total: number;
  skip: number;
  take: number;
}

export interface DashboardLocationGroup {
  key: string; // location_id as string, or 'none' for no-location bucket
  location: {
    location_id: number;
    name: string;
    group: string | null;
  } | null;
  devices: DashboardRow[];
}

export interface DashboardLocationPage {
  groups: DashboardLocationGroup[];
  total: number; // total matching locations
  skip: number;
  take: number;
}

export const DASHBOARD_DATA_TABLES = [
  'cw_air_data',
  'cw_soil_data',
  'cw_water_data',
  'cw_power_data',
  'cw_relay_data',
  'cw_traffic2',
] as const;

export type DashboardDataTable = (typeof DASHBOARD_DATA_TABLES)[number];

export function isDashboardDataTable(name: unknown): name is DashboardDataTable {
  return (
    typeof name === 'string' &&
    (DASHBOARD_DATA_TABLES as readonly string[]).includes(name)
  );
}

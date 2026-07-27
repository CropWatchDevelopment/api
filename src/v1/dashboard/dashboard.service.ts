import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import { READ_EXCLUSIVE_CEILING } from '../common/permission-levels';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';
import { sanitizeOrFilterTerm } from '../common/postgrest-filter.helper';
import type { TableRow } from '../types/supabase';
import {
  DashboardLocationGroup,
  DashboardLocationPage,
  DashboardPage,
  DashboardQuery,
  DashboardRow,
  isDashboardDataTable,
} from './dashboard.types';
import type { AuthenticatedUser } from '../auth/authenticated-user';

type DeviceRow = TableRow<'cw_devices'>;
type DeviceTypeRow = TableRow<'cw_device_type'>;
type LocationRow = TableRow<'cw_locations'>;

type LocationJoin = Pick<LocationRow, 'location_id' | 'name' | 'group'>;
type DeviceTypeJoin = Pick<
  DeviceTypeRow,
  | 'id'
  | 'name'
  | 'data_table_v2'
  | 'primary_data_v2'
  | 'secondary_data_v2'
  | 'default_upload_interval'
>;

/** Columns selected by the device queries in getDevices/getLocations. */
type DashboardDeviceRecord = Pick<
  DeviceRow,
  | 'dev_eui'
  | 'name'
  | 'group'
  | 'upload_interval'
  | 'last_data_updated_at'
  | 'error_status'
> & {
  cw_device_type: DeviceTypeJoin | DeviceTypeJoin[] | null;
  cw_locations: LocationJoin | LocationJoin[] | null;
};

/** Columns selected by the location-listing query in getLocations. */
type DeviceLocationRecord = Pick<DeviceRow, 'location_id'> & {
  cw_locations: LocationJoin | LocationJoin[] | null;
};

/**
 * cw_traffic2 is an hourly accumulator: one row per (dev_eui, traffic_hour,
 * line_number), upserted by an increment RPC that never bumps created_at. A
 * plain ORDER BY created_at DESC LIMIT 1 therefore returns one arbitrary
 * line's bucket — usually the freshly created (near-empty) current-hour one.
 * Dashboard values for traffic devices are instead today's running totals,
 * summed across all hours and detection lines.
 */
const TRAFFIC_COUNT_COLUMNS = [
  'people_count',
  'bicycle_count',
  'motorcycle_count',
  'car_count',
  'bus_count',
  'truck_count',
  'train_count',
] as const;

const TRAFFIC_TIMEZONE = 'Asia/Tokyo';

type TrafficCountColumn = (typeof TRAFFIC_COUNT_COLUMNS)[number];

interface TrafficTodayAggregate {
  sums: Record<TrafficCountColumn, number>;
  latestCreatedAt: string | null;
  latestTrafficHour: string | null;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly timezoneFormatter: TimezoneFormatterService,
  ) {}

  async getDevices(
    user: AuthenticatedUser,
    query: DashboardQuery,
  ): Promise<DashboardPage> {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;

    const skip = Math.max(0, query.skip ?? 0);
    const take = Math.min(Math.max(1, query.take ?? 50), 200);

    // The `name` search matches device name, dev_eui, and location name.
    // Location-name matches are resolved to ids first, then OR'd into the query.
    const nameLocationIds = query.name
      ? await this.findLocationIdsByName(client, query.name)
      : [];

    const hasLocationFilter =
      typeof query.location === 'string' && query.location.trim().length > 0;
    const locationIdFilter = hasLocationFilter
      ? Number(query.location)
      : undefined;
    const locationSelect =
      hasLocationFilter || query.locationGroup
        ? 'cw_locations!inner(location_id, name, group)'
        : 'cw_locations(location_id, name, group)';

    let devicesQuery = client.from('cw_devices').select(
      `dev_eui, name, "group", upload_interval, last_data_updated_at, error_status,
         cw_device_type(id, name, data_table_v2, primary_data_v2, secondary_data_v2, default_upload_interval),
         ${locationSelect},
         owner_match:cw_device_owners()`,
      { count: 'exact' },
    );

    devicesQuery = this.applyDeviceReadScope(
      devicesQuery,
      userId,
      isGlobalUser,
    );

    if (query.group) {
      devicesQuery = devicesQuery.ilike('group', `%${query.group}%`);
    }
    if (query.name) {
      devicesQuery = devicesQuery.or(
        this.buildNameOrFilter(query.name, nameLocationIds),
      );
    }
    if (hasLocationFilter && Number.isFinite(locationIdFilter)) {
      devicesQuery = devicesQuery.eq(
        'cw_locations.location_id',
        locationIdFilter,
      );
    }
    if (query.locationGroup) {
      devicesQuery = devicesQuery.eq('cw_locations.group', query.locationGroup);
    }

    const { data, count, error } = await devicesQuery
      .order('name', { ascending: true })
      .range(skip, skip + take - 1);

    if (error) {
      this.logger.error(`Failed to fetch dashboard devices: ${error.message}`);
      throw new InternalServerErrorException(
        'Failed to fetch dashboard devices',
      );
    }

    const devices = (data ?? []) as DashboardDeviceRecord[];

    const rows = await Promise.all(
      devices.map((d) => this.buildRow(client, d)),
    );

    return {
      rows: rows.filter((r): r is DashboardRow => r !== null),
      total: count ?? rows.length,
      skip,
      take,
    };
  }

  async getLocations(
    user: AuthenticatedUser,
    query: DashboardQuery,
  ): Promise<DashboardLocationPage> {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;

    const skip = Math.max(0, query.skip ?? 0);
    const take = Math.min(Math.max(1, query.take ?? 20), 100);

    // The `name` search matches device name, dev_eui, and location name.
    // Location-name matches are resolved to ids first, then OR'd into the query.
    const nameLocationIds = query.name
      ? await this.findLocationIdsByName(client, query.name)
      : [];

    // Step 1: gather every accessible device's location_id (cheap select).
    // Use an inner join when filtering by location group so non-matching device
    // rows are excluded outright — a non-inner embed only nulls the location,
    // which would leak every location and drop their names (-> "Location <id>").
    const locationSelect = query.locationGroup
      ? 'cw_locations!inner(location_id, name, "group")'
      : 'cw_locations(location_id, name, "group")';
    let locsQuery = client
      .from('cw_devices')
      .select(`location_id, ${locationSelect}, owner_match:cw_device_owners()`);
    locsQuery = this.applyDeviceReadScope(locsQuery, userId, isGlobalUser);
    if (query.group) locsQuery = locsQuery.ilike('group', `%${query.group}%`);
    if (query.name) {
      locsQuery = locsQuery.or(
        this.buildNameOrFilter(query.name, nameLocationIds),
      );
    }
    if (query.locationGroup) {
      locsQuery = locsQuery.eq('cw_locations.group', query.locationGroup);
    }
    const hasLocationIdFilter =
      query.location !== undefined &&
      query.location !== '' &&
      Number.isFinite(Number(query.location));
    if (hasLocationIdFilter) {
      locsQuery = locsQuery.eq('location_id', Number(query.location));
    }

    const { data: locData, error: locError } = await locsQuery;
    if (locError) {
      this.logger.error(
        `Failed to list dashboard locations: ${locError.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to list dashboard locations',
      );
    }

    // Dedupe by location_id; null becomes the special 'none' bucket.
    type LocInfo = {
      location_id: number;
      name: string;
      group: string | null;
    } | null;
    const uniqueLocs = new Map<string, LocInfo>();
    let hasNoLocationBucket = false;
    for (const d of (locData ?? []) as DeviceLocationRecord[]) {
      const locId = d.location_id;
      if (locId == null) {
        hasNoLocationBucket = true;
        continue;
      }
      const key = String(locId);
      if (uniqueLocs.has(key)) continue;
      const rawLoc = d.cw_locations;
      const loc = Array.isArray(rawLoc) ? rawLoc[0] : rawLoc;
      uniqueLocs.set(key, {
        location_id: locId,
        name: loc?.name ?? `Location ${locId}`,
        group: loc?.group ?? null,
      });
    }

    const sortedLocs: Array<[string, LocInfo]> = [...uniqueLocs.entries()].sort(
      (a, b) => (a[1]?.name ?? '').localeCompare(b[1]?.name ?? ''),
    );
    if (hasNoLocationBucket) {
      sortedLocs.push(['none', null]);
    }

    const total = sortedLocs.length;
    const pagedLocs = sortedLocs.slice(skip, skip + take);

    if (pagedLocs.length === 0) {
      return { groups: [], total, skip, take };
    }

    // Step 2: fetch all accessible devices for the paged location set.
    const locIds = pagedLocs
      .filter(([, v]) => v != null)
      .map(([, v]) => (v as { location_id: number }).location_id);
    const includeNoLoc = pagedLocs.some(([k]) => k === 'none');

    let devicesQuery = client.from('cw_devices').select(
      `dev_eui, name, "group", upload_interval, last_data_updated_at, error_status,
         cw_device_type(id, name, data_table_v2, primary_data_v2, secondary_data_v2, default_upload_interval),
         cw_locations(location_id, name, "group"),
         owner_match:cw_device_owners()`,
    );
    devicesQuery = this.applyDeviceReadScope(
      devicesQuery,
      userId,
      isGlobalUser,
    );

    if (includeNoLoc && locIds.length > 0) {
      devicesQuery = devicesQuery.or(
        `location_id.in.(${locIds.join(',')}),location_id.is.null`,
      );
    } else if (includeNoLoc) {
      devicesQuery = devicesQuery.is('location_id', null);
    } else {
      devicesQuery = devicesQuery.in('location_id', locIds);
    }

    if (query.group)
      devicesQuery = devicesQuery.ilike('group', `%${query.group}%`);
    if (query.name) {
      devicesQuery = devicesQuery.or(
        this.buildNameOrFilter(query.name, nameLocationIds),
      );
    }

    const { data: devices, error: devicesError } = await devicesQuery.order(
      'name',
      { ascending: true },
    );
    if (devicesError) {
      this.logger.error(
        `Failed to fetch devices for dashboard locations: ${devicesError.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to fetch dashboard devices',
      );
    }

    const rows = (
      await Promise.all(
        ((devices ?? []) as DashboardDeviceRecord[]).map((d) =>
          this.buildRow(client, d),
        ),
      )
    ).filter((r): r is DashboardRow => r !== null);

    // Bucket devices into the page's location slots, preserving page order.
    const groupsByKey = new Map<string, DashboardLocationGroup>();
    for (const [key, loc] of pagedLocs) {
      groupsByKey.set(key, { key, location: loc, devices: [] });
    }
    for (const row of rows) {
      const key =
        row.location?.location_id != null
          ? String(row.location.location_id)
          : 'none';
      const bucket = groupsByKey.get(key);
      if (bucket) bucket.devices.push(row);
    }

    // Drop empty buckets (can happen when name filter excludes all devices in a slot).
    const groups = [...groupsByKey.values()].filter(
      (g) => g.devices.length > 0,
    );

    return { groups, total, skip, take };
  }

  async getLatest(
    user: AuthenticatedUser,
    devEui: string,
  ): Promise<Record<string, unknown> | null> {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;
    const normalized = devEui?.trim();

    if (!normalized) {
      throw new BadRequestException('dev_eui is required');
    }

    let deviceQuery = client
      .from('cw_devices')
      .select(
        'dev_eui, cw_device_type(data_table_v2), owner_match:cw_device_owners()',
      )
      .eq('dev_eui', normalized);

    deviceQuery = this.applyDeviceReadScope(deviceQuery, userId, isGlobalUser);

    const { data: device, error: deviceError } =
      await deviceQuery.maybeSingle();

    if (deviceError) {
      this.logger.error(
        `Failed to look up device ${normalized}: ${deviceError.message}`,
      );
      throw new InternalServerErrorException('Failed to look up device');
    }
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const deviceRecord = device as Pick<DeviceRow, 'dev_eui'> & {
      cw_device_type:
        | Pick<DeviceTypeRow, 'data_table_v2'>
        | Pick<DeviceTypeRow, 'data_table_v2'>[]
        | null;
    };
    const deviceType = Array.isArray(deviceRecord.cw_device_type)
      ? deviceRecord.cw_device_type[0]
      : deviceRecord.cw_device_type;
    const table = deviceType?.data_table_v2;

    if (!isDashboardDataTable(table)) {
      throw new InternalServerErrorException(
        'Device type has no data table configured',
      );
    }

    if (table === 'cw_traffic2') {
      const aggregate = await this.fetchTrafficToday(client, normalized);
      if (!aggregate) return null;

      return {
        dev_eui: normalized,
        created_at: aggregate.latestCreatedAt,
        traffic_hour: aggregate.latestTrafficHour,
        ...aggregate.sums,
      };
    }

    const { data: latest, error: latestError } = (await client
      .from(table)
      .select('*')
      .eq('dev_eui', normalized)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()) as {
      data: Record<string, unknown> | null;
      error: PostgrestError | null;
    };

    if (latestError) {
      this.logger.error(
        `Failed to fetch latest data for ${normalized}: ${latestError.message}`,
      );
      throw new InternalServerErrorException('Failed to fetch latest data');
    }

    return latest ?? null;
  }

  private async buildRow(
    client: ReturnType<SupabaseService['getClient']>,
    d: DashboardDeviceRecord,
  ): Promise<DashboardRow | null> {
    const deviceType = Array.isArray(d.cw_device_type)
      ? d.cw_device_type[0]
      : d.cw_device_type;
    if (!deviceType) {
      this.logger.warn(`Device ${d.dev_eui} has no device type — skipping`);
      return null;
    }

    const table = deviceType.data_table_v2;
    const location = Array.isArray(d.cw_locations)
      ? d.cw_locations[0]
      : d.cw_locations;

    const latest = isDashboardDataTable(table)
      ? await this.fetchLatest(
          client,
          table,
          d.dev_eui,
          deviceType.primary_data_v2,
          deviceType.secondary_data_v2,
        )
      : null;

    return {
      dev_eui: d.dev_eui,
      name: d.name,
      group: d.group ?? null,
      upload_interval: d.upload_interval ?? null,
      last_data_updated_at: d.last_data_updated_at ?? null,
      error_status: d.error_status ?? null,
      device_type: {
        id: deviceType.id,
        name: deviceType.name,
        data_table_v2: deviceType.data_table_v2,
        primary_data_v2: deviceType.primary_data_v2,
        secondary_data_v2: deviceType.secondary_data_v2,
        default_upload_interval: deviceType.default_upload_interval ?? null,
      },
      location: location
        ? {
            location_id: location.location_id,
            name: location.name,
            group: location.group ?? null,
          }
        : null,
      latest,
    };
  }

  private async fetchLatest(
    client: ReturnType<SupabaseService['getClient']>,
    table: string,
    devEui: string,
    primaryCol: string,
    secondaryCol: string,
  ): Promise<DashboardRow['latest']> {
    if (table === 'cw_traffic2') {
      const aggregate = await this.fetchTrafficToday(client, devEui);
      if (!aggregate) return null;

      const hasSecondary =
        Boolean(secondaryCol) && secondaryCol !== '-' && secondaryCol !== '';
      const readSum = (col: string): number | null =>
        (TRAFFIC_COUNT_COLUMNS as readonly string[]).includes(col)
          ? aggregate.sums[col as TrafficCountColumn]
          : null;

      return {
        created_at: aggregate.latestCreatedAt,
        primary: primaryCol && primaryCol !== '-' ? readSum(primaryCol) : null,
        secondary: hasSecondary ? readSum(secondaryCol) : null,
      };
    }

    const cols = new Set<string>(['created_at']);
    if (primaryCol && primaryCol !== '-') cols.add(primaryCol);
    if (secondaryCol && secondaryCol !== '-' && secondaryCol !== '') {
      cols.add(secondaryCol);
    }

    const { data, error } = await client
      .from(table)
      .select([...cols].join(','))
      .eq('dev_eui', devEui)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const row = data as unknown as Record<string, unknown>;
    const hasSecondary =
      Boolean(secondaryCol) && secondaryCol !== '-' && secondaryCol !== '';
    return {
      created_at: (row.created_at as string | null) ?? null,
      primary:
        primaryCol && primaryCol !== '-' ? (row[primaryCol] ?? null) : null,
      secondary: hasSecondary ? (row[secondaryCol] ?? null) : null,
    } as DashboardRow['latest'];
  }

  /**
   * Today's traffic totals for one device: every cw_traffic2 count column
   * summed across all of today's hour buckets and detection lines. "Today" is
   * the local day in Asia/Tokyo (matching TrafficService's default). Returns
   * zero totals when the device has history but no rows today — a quiet day
   * is legitimately 0 — and null only when the device has no data at all.
   */
  private async fetchTrafficToday(
    client: ReturnType<SupabaseService['getClient']>,
    devEui: string,
  ): Promise<TrafficTodayAggregate | null> {
    const now = new Date();
    const [year, month, day] = this.timezoneFormatter
      .toLocalDateString(now.toISOString(), TRAFFIC_TIMEZONE)
      .split('-')
      .map(Number);
    const startUtc = this.timezoneFormatter.localMidnightToUtc(
      year,
      month,
      day,
      TRAFFIC_TIMEZONE,
    );
    const endUtc = this.timezoneFormatter.localMidnightToUtc(
      year,
      month,
      day + 1,
      TRAFFIC_TIMEZONE,
    );

    const selectColumns = `created_at, traffic_hour, ${TRAFFIC_COUNT_COLUMNS.join(', ')}`;
    const { data, error } = await client
      .from('cw_traffic2')
      .select(selectColumns)
      .eq('dev_eui', devEui)
      .gte('traffic_hour', startUtc.toISOString())
      .lt('traffic_hour', endUtc.toISOString());

    if (error) {
      this.logger.warn(
        `Failed to aggregate today's traffic for ${devEui}: ${error.message}`,
      );
      return null;
    }

    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const sums = Object.fromEntries(
      TRAFFIC_COUNT_COLUMNS.map((col) => [col, 0]),
    ) as Record<TrafficCountColumn, number>;
    let latestCreatedAt: string | null = null;
    let latestTrafficHour: string | null = null;

    for (const row of rows) {
      for (const col of TRAFFIC_COUNT_COLUMNS) {
        const value = row[col];
        if (typeof value === 'number' && Number.isFinite(value)) {
          sums[col] += value;
        }
      }
      const createdAt = row.created_at;
      if (
        typeof createdAt === 'string' &&
        (!latestCreatedAt || createdAt > latestCreatedAt)
      ) {
        latestCreatedAt = createdAt;
      }
      const trafficHour = row.traffic_hour;
      if (
        typeof trafficHour === 'string' &&
        (!latestTrafficHour || trafficHour > latestTrafficHour)
      ) {
        latestTrafficHour = trafficHour;
      }
    }

    if (rows.length === 0) {
      // No buckets today: report zero totals, but keep the freshness stamp of
      // the most recent bucket so "last seen" stays truthful.
      const { data: lastRow, error: lastError } = (await client
        .from('cw_traffic2')
        .select('created_at, traffic_hour')
        .eq('dev_eui', devEui)
        .order('traffic_hour', { ascending: false })
        .limit(1)
        .maybeSingle()) as {
        data: { created_at: string | null; traffic_hour: string | null } | null;
        error: PostgrestError | null;
      };

      if (lastError || !lastRow) {
        return null;
      }
      latestCreatedAt = lastRow.created_at ?? null;
      latestTrafficHour = lastRow.traffic_hour ?? null;
    }

    return { sums, latestCreatedAt, latestTrafficHour };
  }

  /**
   * Resolve location ids whose name matches the search term, so a device-table
   * query can OR in `location_id.in.(...)` and surface devices by location name.
   * Scoped by the caller's RLS client; failures degrade to an empty list.
   */
  private async findLocationIdsByName(
    client: ReturnType<SupabaseService['getClient']>,
    name: string,
  ): Promise<number[]> {
    const { data, error } = await client
      .from('cw_locations')
      .select('location_id')
      .ilike('name', `%${name}%`);

    if (error) {
      this.logger.warn(`Failed to search locations by name: ${error.message}`);
      return [];
    }

    return ((data ?? []) as Pick<LocationRow, 'location_id'>[])
      .map((l) => l.location_id)
      .filter((id: unknown): id is number => typeof id === 'number');
  }

  /**
   * Build the PostgREST `.or(...)` term for the `name` search: matches device
   * name, dev_eui, and — via pre-resolved ids — location name.
   */
  private buildNameOrFilter(name: string, locationIds: number[]): string {
    const safeName = sanitizeOrFilterTerm(name);
    const parts = [`name.ilike.%${safeName}%`, `dev_eui.ilike.%${safeName}%`];
    if (locationIds.length > 0) {
      parts.push(`location_id.in.(${locationIds.join(',')})`);
    }
    return parts.join(',');
  }

  private applyDeviceReadScope<
    Q extends {
      eq(column: string, value: unknown): Q;
      lt(column: string, value: unknown): Q;
      or(filters: string): Q;
    },
  >(query: Q, userId: string, isGlobalUser: boolean): Q {
    if (isGlobalUser) {
      return query;
    }
    return query
      .eq('owner_match.user_id', userId)
      .lt('owner_match.permission_level', READ_EXCLUSIVE_CEILING)
      .or(`user_id.eq.${userId},owner_match.not.is.null`);
  }
}

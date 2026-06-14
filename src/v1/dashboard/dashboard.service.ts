import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  getAccessToken,
  getUserId,
  isCropwatchStaff,
} from '../../supabase/supabase-token.helper';
import { READ_EXCLUSIVE_CEILING } from '../common/permission-levels';
import {
  DashboardLocationGroup,
  DashboardLocationPage,
  DashboardPage,
  DashboardQuery,
  DashboardRow,
  isDashboardDataTable,
} from './dashboard.types';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async getDevices(
    jwtPayload: any,
    authHeader: string,
    query: DashboardQuery,
  ): Promise<DashboardPage> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

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

    let devicesQuery = client
      .from('cw_devices')
      .select(
        `dev_eui, name, "group", upload_interval, last_data_updated_at, error_status,
         cw_device_type(id, name, data_table_v2, primary_data_v2, secondary_data_v2, default_upload_interval),
         ${locationSelect},
         owner_match:cw_device_owners()`,
        { count: 'exact' },
      );

    devicesQuery = this.applyDeviceReadScope(devicesQuery, userId, isGlobalUser);

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
      throw new InternalServerErrorException('Failed to fetch dashboard devices');
    }

    const devices = data ?? [];

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
    jwtPayload: any,
    authHeader: string,
    query: DashboardQuery,
  ): Promise<DashboardLocationPage> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

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
      .select(
        `location_id, ${locationSelect}, owner_match:cw_device_owners()`,
      );
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
      this.logger.error(`Failed to list dashboard locations: ${locError.message}`);
      throw new InternalServerErrorException('Failed to list dashboard locations');
    }

    // Dedupe by location_id; null becomes the special 'none' bucket.
    type LocInfo = {
      location_id: number;
      name: string;
      group: string | null;
    } | null;
    const uniqueLocs = new Map<string, LocInfo>();
    let hasNoLocationBucket = false;
    for (const d of locData ?? []) {
      const locId = (d as any).location_id;
      if (locId == null) {
        hasNoLocationBucket = true;
        continue;
      }
      const key = String(locId);
      if (uniqueLocs.has(key)) continue;
      const rawLoc = (d as any).cw_locations;
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

    let devicesQuery = client
      .from('cw_devices')
      .select(
        `dev_eui, name, "group", upload_interval, last_data_updated_at, error_status,
         cw_device_type(id, name, data_table_v2, primary_data_v2, secondary_data_v2, default_upload_interval),
         cw_locations(location_id, name, "group"),
         owner_match:cw_device_owners()`,
      );
    devicesQuery = this.applyDeviceReadScope(devicesQuery, userId, isGlobalUser);

    if (includeNoLoc && locIds.length > 0) {
      devicesQuery = devicesQuery.or(
        `location_id.in.(${locIds.join(',')}),location_id.is.null`,
      );
    } else if (includeNoLoc) {
      devicesQuery = devicesQuery.is('location_id', null);
    } else {
      devicesQuery = devicesQuery.in('location_id', locIds);
    }

    if (query.group) devicesQuery = devicesQuery.ilike('group', `%${query.group}%`);
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
      throw new InternalServerErrorException('Failed to fetch dashboard devices');
    }

    const rows = (
      await Promise.all((devices ?? []).map((d) => this.buildRow(client, d)))
    ).filter((r): r is DashboardRow => r !== null);

    // Bucket devices into the page's location slots, preserving page order.
    const groupsByKey = new Map<string, DashboardLocationGroup>();
    for (const [key, loc] of pagedLocs) {
      groupsByKey.set(key, { key, location: loc, devices: [] });
    }
    for (const row of rows) {
      const key =
        row.location?.location_id != null ? String(row.location.location_id) : 'none';
      const bucket = groupsByKey.get(key);
      if (bucket) bucket.devices.push(row);
    }

    // Drop empty buckets (can happen when name filter excludes all devices in a slot).
    const groups = [...groupsByKey.values()].filter((g) => g.devices.length > 0);

    return { groups, total, skip, take };
  }

  async getLatest(
    jwtPayload: any,
    devEui: string,
    authHeader: string,
  ): Promise<Record<string, unknown> | null> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
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

    const { data: device, error: deviceError } = await deviceQuery.maybeSingle();

    if (deviceError) {
      this.logger.error(
        `Failed to look up device ${normalized}: ${deviceError.message}`,
      );
      throw new InternalServerErrorException('Failed to look up device');
    }
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const deviceType = Array.isArray(device.cw_device_type)
      ? device.cw_device_type[0]
      : device.cw_device_type;
    const table = deviceType?.data_table_v2;

    if (!isDashboardDataTable(table)) {
      throw new InternalServerErrorException(
        'Device type has no data table configured',
      );
    }

    const { data: latest, error: latestError } = await client
      .from(table)
      .select('*')
      .eq('dev_eui', normalized)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      this.logger.error(
        `Failed to fetch latest data for ${normalized}: ${latestError.message}`,
      );
      throw new InternalServerErrorException('Failed to fetch latest data');
    }

    return (latest as Record<string, unknown> | null) ?? null;
  }

  private async buildRow(
    client: ReturnType<SupabaseService['getClient']>,
    d: any,
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
      primary: primaryCol && primaryCol !== '-' ? (row[primaryCol] ?? null) : null,
      secondary: hasSecondary ? (row[secondaryCol] ?? null) : null,
    } as DashboardRow['latest'];
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

    return (data ?? [])
      .map((l: any) => l.location_id)
      .filter((id: unknown): id is number => typeof id === 'number');
  }

  /**
   * Build the PostgREST `.or(...)` term for the `name` search: matches device
   * name, dev_eui, and — via pre-resolved ids — location name.
   */
  private buildNameOrFilter(name: string, locationIds: number[]): string {
    const parts = [`name.ilike.%${name}%`, `dev_eui.ilike.%${name}%`];
    if (locationIds.length > 0) {
      parts.push(`location_id.in.(${locationIds.join(',')})`);
    }
    return parts.join(',');
  }

  private applyDeviceReadScope(
    query: any,
    userId: string,
    isGlobalUser: boolean,
  ) {
    if (isGlobalUser) {
      return query;
    }
    return query
      .eq('owner_match.user_id', userId)
      .lt('owner_match.permission_level', READ_EXCLUSIVE_CEILING)
      .or(`user_id.eq.${userId},owner_match.not.is.null`);
  }
}

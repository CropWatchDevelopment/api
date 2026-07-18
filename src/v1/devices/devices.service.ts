import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import type { TableRow } from '../types/supabase';
import { LocationsService } from '../locations/locations.service';
import { PaymentsService } from '../payments/payments.service';
import { sanitizeOrFilterTerm } from '../common/postgrest-filter.helper';
import { CreateDeviceDto } from './dto/create-device.dto';
import {
  MANAGE_CEILING,
  PermissionLevel,
  READ_EXCLUSIVE_CEILING,
} from '../common/permission-levels';
import type { AuthenticatedUser } from '../auth/authenticated-user';

type DeviceRow = TableRow<'cw_devices'>;
type DeviceOwnerRow = TableRow<'cw_device_owners'>;
type DeviceTypeRow = TableRow<'cw_device_type'>;
type LocationRow = TableRow<'cw_locations'>;
type LocationOwnerRow = TableRow<'cw_location_owners'>;

type LocationJoin = Pick<LocationRow, 'location_id' | 'name' | 'group'>;

/** Device row plus the relations embedded by the select strings below. */
type DeviceRecord = DeviceRow & {
  /** Not present in the generated cw_devices Row type; read defensively by findLatestData. */
  created_at?: string | null;
  cw_device_owners?: DeviceOwnerRow[];
  cw_locations?: LocationJoin | LocationJoin[] | null;
  cw_device_type?: DeviceTypeRow | DeviceTypeRow[] | null;
};

type LatestDeviceTypeJoin = Pick<
  DeviceTypeRow,
  | 'name'
  | 'default_upload_interval'
  | 'primary_data_v2'
  | 'secondary_data_v2'
  | 'data_table_v2'
>;

/** Columns selected by findAllLatestData. */
type LatestDeviceRecord = Pick<
  DeviceRow,
  'dev_eui' | 'name' | 'group' | 'location_id' | 'last_data_updated_at'
> & {
  cw_device_type: LatestDeviceTypeJoin | LatestDeviceTypeJoin[] | null;
  cw_locations: LocationJoin | LocationJoin[] | null;
};

/** Row from a per-device-type data table (cw_air_data, ...) — columns vary by table. */
type SensorDataRow = Record<string, unknown>;

type SingleResult<T> = { data: T | null; error: PostgrestError | null };
type ListResult<T> = {
  data: T[] | null;
  count?: number | null;
  error: PostgrestError | null;
};

/** Structural shape of the PostgREST filter builder methods the scope helpers use. */
interface DeviceScopeQuery<Q> {
  eq(column: string, value: unknown): Q;
  lt(column: string, value: unknown): Q;
  lte(column: string, value: unknown): Q;
  or(filters: string): Q;
}

export interface PagedDevicesResponse<T> {
  total?: number;
  skip: number;
  take: number;
  data: T[];
}

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly locationsService: LocationsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async findAll(
    user: AuthenticatedUser,
    skip: number = 0,
    take?: number,
    searchGroup?: string,
    searchName?: string,
    searchLocation?: string,
  ): Promise<PagedDevicesResponse<DeviceRecord>> {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;

    let devicesQuery = client.from('cw_devices').select(
      `
    *,
    owner_match:cw_device_owners(),
    cw_device_owners(*),
    cw_locations(name, location_id)
  `,
      { count: 'exact' },
    );

    devicesQuery = this.applyDeviceReadScope(
      devicesQuery,
      userId,
      isGlobalUser,
    );

    if (searchGroup) {
      devicesQuery = devicesQuery.ilike('group', `%${searchGroup}%`);
    }
    if (searchName) {
      const safeName = sanitizeOrFilterTerm(searchName);
      devicesQuery = devicesQuery.or(
        `name.ilike.%${safeName}%,dev_eui.ilike.%${safeName}%`,
      );
    }
    if (searchLocation) {
      devicesQuery = devicesQuery.ilike('location', `%${searchLocation}%`);
    }

    devicesQuery = devicesQuery.order('name', { ascending: true });

    if (typeof take === 'number' && take > 0) {
      devicesQuery = devicesQuery.range(skip, skip + take - 1).limit(take);
    }

    const { data, count, error } = await devicesQuery;

    if (error) {
      throw new InternalServerErrorException('Failed to fetch devices');
    }

    const rows = (data ?? []) as DeviceRecord[];
    const responseTake =
      typeof take === 'number' ? take : (count ?? rows.length);

    return {
      total: count ?? 0,
      skip,
      take: responseTake,
      data: rows,
    };
  }

  async findOne(
    user: AuthenticatedUser,
    devEui: string,
  ): Promise<DeviceRecord> {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    let query = client
      .from('cw_devices')
      .select(
        `
    *,
    owner_match:cw_device_owners(),
    cw_device_owners(*),
    cw_locations(name, location_id),
    cw_device_type(*)
  `,
      )
      .eq('dev_eui', normalizedDevEui);

    query = this.applyDeviceReadScope(query, userId, isGlobalUser);

    const { data, error } = (await query
      .order('name', { ascending: true })
      .single()) as SingleResult<DeviceRecord>;

    if (error) {
      throw new InternalServerErrorException('Failed to fetch device');
    }

    if (!data) {
      throw new NotFoundException('Device not found');
    }

    return data;
  }

  public async findAllStatus(
    user: AuthenticatedUser,
  ): Promise<{ online: number; offline: number }> {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;

    let query = client
      .from('cw_devices')
      .select(
        'owner_match:cw_device_owners(), last_data_updated_at, upload_interval, cw_device_type(default_upload_interval)',
      );

    query = this.applyDeviceReadScope(query, userId, isGlobalUser);

    const { data: devices, error: devicesError } = await query.order('name', {
      ascending: true,
    });

    if (devicesError) {
      throw new InternalServerErrorException('Failed to fetch devices');
    }

    if (!devices || devices.length === 0) {
      throw new NotFoundException('No devices found');
    }

    const now = new Date();

    let onlineCount = 0;
    let offlineCount = 0;

    devices.forEach((device) => {
      const lastUpdated = new Date(device.last_data_updated_at);
      const minutesSinceLastUpdate =
        (now.getTime() - lastUpdated.getTime()) / (1000 * 60);
      const deviceType = Array.isArray(device.cw_device_type)
        ? device.cw_device_type[0]
        : device.cw_device_type;
      if (
        minutesSinceLastUpdate <=
        (device.upload_interval
          ? device.upload_interval
          : (deviceType?.default_upload_interval as number))
      ) {
        onlineCount++;
      } else {
        offlineCount++;
      }
    });

    return { online: onlineCount, offline: offlineCount };
  }

  public async findAllDeviceGroups(
    user: AuthenticatedUser,
  ): Promise<{ group: string | null; count: number }[]> {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;

    let query = client
      .from('cw_devices')
      .select('owner_match:cw_device_owners(), cw_device_owners(*), group')
      .not('group', 'is', null);

    query = this.applyDeviceReadScope(query, userId, isGlobalUser);

    const { data: groups, error } = await query;

    if (error) {
      throw new InternalServerErrorException('Failed to fetch device groups');
    }

    if (!groups || groups.length === 0) {
      throw new NotFoundException('No device groups found');
    }

    const groupRows = groups as Pick<DeviceRow, 'group'>[];
    const groupCounts = groupRows.reduce(
      (acc, item) => {
        const existing = acc.find((g) => g.group === item.group);
        if (existing) {
          existing.count++;
        } else {
          acc.push({ group: item.group, count: 1 });
        }
        return acc;
      },
      [] as { group: string | null; count: number }[],
    );

    return groupCounts;
  }

  public async findAllDeviceTypes(): Promise<DeviceTypeRow[]> {
    const client = this.supabaseService.getClient();

    const { data: types, error } = await client
      .from('cw_device_type')
      .select('*');

    if (error) {
      throw new InternalServerErrorException('Failed to fetch device types');
    }

    if (!types || types.length === 0) {
      throw new NotFoundException('No device types found');
    }

    return types as DeviceTypeRow[];
  }

  public async findData(
    user: AuthenticatedUser,
    devEui: string,
    skip: number = 0,
    take: number = 144,
  ): Promise<PagedDevicesResponse<SensorDataRow>> {
    this.logger.log(
      `findData called: devEui=${devEui}, skip=${skip}, take=${take}`,
    );
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      this.logger.warn('findData: dev_eui is empty or missing');
      throw new BadRequestException('dev_eui is required');
    }

    this.logger.debug(
      `findData: fetching device for devEui=${normalizedDevEui}, userId=${userId}`,
    );
    let deviceQuery = client
      .from('cw_devices')
      .select(
        `
    *,
    owner_match:cw_device_owners(),
    cw_device_owners(*)
  `,
      )
      .eq('dev_eui', normalizedDevEui);

    deviceQuery = this.applyDeviceReadScope(deviceQuery, userId, isGlobalUser);

    const { data: device, error: deviceError } =
      (await deviceQuery.single()) as SingleResult<DeviceRecord>;

    if (deviceError) {
      this.logger.error(
        `findData: failed to fetch device devEui=${normalizedDevEui}`,
        deviceError.message,
      );
      throw new InternalServerErrorException('Failed to fetch device');
    }

    if (!device) {
      this.logger.warn(
        `findData: device not found for devEui=${normalizedDevEui}`,
      );
      throw new NotFoundException('Device not found');
    }

    this.logger.debug(
      `findData: fetching device type id=${device.type} for devEui=${normalizedDevEui}`,
    );
    const { data: deviceType, error: deviceTypeError } = (await client
      .from('cw_device_type')
      .select('*')
      .eq('id', device.type)
      .maybeSingle()) as SingleResult<DeviceTypeRow>;

    if (deviceTypeError) {
      this.logger.error(
        `findData: failed to fetch device type id=${device.type}`,
        deviceTypeError.message,
      );
      throw new InternalServerErrorException('Failed to fetch device type');
    }

    if (!deviceType) {
      this.logger.warn(`findData: device type not found for id=${device.type}`);
      throw new NotFoundException('Device type not found');
    }

    const dataTable = deviceType.data_table_v2;
    const allowedTables = [
      'cw_air_data',
      'cw_soil_data',
      'cw_water_data',
      'cw_power_data',
      'cw_traffic2',
      'cw_relay_data',
    ];
    if (!allowedTables.includes(dataTable)) {
      this.logger.warn(
        `findData: unexpected data table "${dataTable}" for devEui=${normalizedDevEui}`,
      );
    }

    const getAnnotations =
      dataTable === 'cw_air_data'
        ? '*, cw_air_annotations(*), cw_air_alerts(*)'
        : '*';
    this.logger.debug(
      `findData: querying table=${dataTable}, select=${getAnnotations}, range=${skip}-${skip + take - 1}`,
    );
    const { data: latestData, error: dataError } = (await client
      .from(dataTable)
      .select(`${getAnnotations}`)
      .eq('dev_eui', normalizedDevEui)
      .order('created_at', { ascending: false })
      .range(skip, skip + take - 1)
      .limit(take)) as ListResult<SensorDataRow>;

    if (dataError) {
      this.logger.error(
        `findData: failed to fetch data from table=${dataTable} for devEui=${normalizedDevEui}`,
        dataError.message,
      );
      throw new InternalServerErrorException('Failed to fetch Data');
    }

    if (!latestData || latestData.length === 0) {
      this.logger.warn(
        `findData: no data rows found in table=${dataTable} for devEui=${normalizedDevEui}`,
      );
      throw new NotFoundException('Data not found');
    }

    // this.logger.debug(`findData: total count=${count} in table=${dataTable}`);
    this.logger.log(
      `findData: returning ${latestData.length} rows for devEui=${normalizedDevEui}`,
    );
    return {
      skip,
      take,
      data: latestData,
    };
  }

  public async findDataWithinRange(
    user: AuthenticatedUser,
    devEui: string,
    start: Date | string = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString(),
    end: Date | string = new Date().toISOString(),
    skip: number = 0,
    take: number = 144,
  ): Promise<PagedDevicesResponse<SensorDataRow>> {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    let deviceQuery = client
      .from('cw_devices')
      .select(`*, owner_match:cw_device_owners(), cw_device_owners(*)`)
      .eq('dev_eui', normalizedDevEui);

    deviceQuery = this.applyDeviceReadScope(deviceQuery, userId, isGlobalUser);

    const { data: device, error: deviceError } =
      (await deviceQuery.single()) as SingleResult<DeviceRecord>;

    if (deviceError) {
      this.logger.error(
        `Failed to fetch device ${normalizedDevEui}`,
        deviceError.message,
      );
      throw new InternalServerErrorException('Failed to fetch device');
    }

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const { data: deviceType, error: deviceTypeError } = (await client
      .from('cw_device_type')
      .select('*')
      .eq('id', device.type)
      .maybeSingle()) as SingleResult<DeviceTypeRow>;

    if (deviceTypeError) {
      throw new InternalServerErrorException('Failed to fetch device type');
    }

    if (!deviceType) {
      throw new NotFoundException('Device type not found');
    }

    const startDate = new Date(start).toISOString();
    const endDate = new Date(end).toISOString();

    const { data: latestData, error: dataError } = (await client
      .from(deviceType.data_table_v2)
      .select('*')
      .eq('dev_eui', normalizedDevEui)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false })
      .range(skip, skip + take - 1)) as ListResult<SensorDataRow>;

    if (dataError) {
      throw new InternalServerErrorException('Failed to fetch Data');
    }

    if (!latestData || latestData.length === 0) {
      throw new NotFoundException('Data not found');
    }

    return {
      skip,
      take,
      data: latestData,
    };
  }

  public async findAllLatestData(
    user: AuthenticatedUser,
    skip: number = 0,
    take: number = 10,
    searchGroup?: string,
    searchName?: string,
    searchLocation?: string,
    locationGroup?: string,
  ): Promise<PagedDevicesResponse<Record<string, unknown>>> {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;
    const hasLocationFilter =
      typeof searchLocation === 'string' && searchLocation.trim().length > 0;
    const locationIdFilter = hasLocationFilter
      ? Number(searchLocation)
      : undefined;
    const dataLocationSelect = hasLocationFilter
      ? 'cw_locations!inner(location_id, name, group)'
      : 'cw_locations(location_id, name, group)';

    let devicesQuery = client
      .from('cw_devices')
      .select(
        `dev_eui, name, group, location_id, last_data_updated_at, cw_device_type(name, default_upload_interval, primary_data_v2, secondary_data_v2, data_table_v2), ${dataLocationSelect}, owner_match:cw_device_owners()`,
        { count: 'exact' },
      );

    devicesQuery = this.applyDeviceReadScope(
      devicesQuery,
      userId,
      isGlobalUser,
    );

    if (searchGroup) {
      devicesQuery = devicesQuery.ilike('group', `%${searchGroup}%`);
    }
    if (searchName) {
      const safeName = sanitizeOrFilterTerm(searchName);
      devicesQuery = devicesQuery.or(
        `name.ilike.%${safeName}%,dev_eui.ilike.%${safeName}%`,
      );
    }
    if (hasLocationFilter && Number.isFinite(locationIdFilter)) {
      devicesQuery = devicesQuery.eq(
        'cw_locations.location_id',
        locationIdFilter,
      );
    }
    if (locationGroup) {
      devicesQuery = devicesQuery.eq('cw_locations.group', locationGroup);
      devicesQuery = devicesQuery.not('cw_locations', 'is', null);
      devicesQuery = devicesQuery.not('cw_locations.group', 'is', null);
    }

    const {
      data: device,
      count,
      error: deviceError,
    } = await devicesQuery
      .order('name', { ascending: false })
      .range(skip, skip + take - 1);

    if (deviceError) {
      throw new InternalServerErrorException('Failed to fetch device');
    }

    if (!device) {
      throw new NotFoundException('Device not found');
    }
    if (device.length === 0) {
      throw new NotFoundException('No devices found');
    }

    const deviceRows = device as LatestDeviceRecord[];
    const devicesWithLatestData = (
      await Promise.all(
        deviceRows.map(async (d) => {
          const deviceType = Array.isArray(d.cw_device_type)
            ? d.cw_device_type[0]
            : d.cw_device_type;
          if (!deviceType) {
            this.logger.warn(
              `Skipping device ${d.dev_eui} because its device type is missing`,
            );
            return null;
          }

          const location = Array.isArray(d.cw_locations)
            ? d.cw_locations[0]
            : d.cw_locations;

          const latestFields = new Set([
            'created_at',
            deviceType.primary_data_v2,
            deviceType.secondary_data_v2,
          ]);

          if (deviceType.data_table_v2 === 'cw_air_data') {
            latestFields.add('humidity');
          }

          // sometimes the SET has empty values, we need to clean them
          const latestFieldsCleaned = new Set(
            [...latestFields].filter((v) => v !== ''),
          );

          const { data: latestData, error: dataError } = await client
            .from(deviceType.data_table_v2)
            .select(Array.from(latestFieldsCleaned).join(', '))
            .eq('dev_eui', d.dev_eui)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (dataError) {
            this.logger.warn(
              `Skipping device ${d.dev_eui} because its latest data query failed: ${dataError.message}`,
            );
            return null;
          }
          if (!latestData) {
            this.logger.debug(
              `Skipping device ${d.dev_eui} because it has no latest primary data`,
            );
            return null;
          }

          const latestRow = latestData as unknown as Record<string, unknown> & {
            created_at: string;
            humidity?: number | null;
          };

          const primaryField = deviceType.primary_data_v2;
          const secondaryField = deviceType.secondary_data_v2;
          return {
            dev_eui: d.dev_eui,
            name: d.name,
            device_type: deviceType.name,
            location_name: location?.name ?? 'n/a',
            location_id: d.location_id,
            group: d.group,
            created_at: d.last_data_updated_at,
            default_upload_interval: deviceType.default_upload_interval,
            [primaryField]: latestRow[primaryField],
            [secondaryField]: latestRow[secondaryField],
            // if humidity, add it here
            humidity: latestRow.humidity,
          };
        }),
      )
    ).filter(
      (deviceRow): deviceRow is NonNullable<typeof deviceRow> =>
        deviceRow !== null,
    );

    return {
      total: count ?? 0,
      skip,
      take,
      data: devicesWithLatestData,
    };
  }

  public async findAllDevicesInLocation(
    user: AuthenticatedUser,
    locationId: number,
  ): Promise<DeviceRecord[]> {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;

    let query = client
      .from('cw_devices')
      .select('*, owner_match:cw_device_owners()')
      .eq('location_id', locationId);

    query = this.applyDeviceReadScope(query, userId, isGlobalUser);

    const { data: devices, error: devicesError } = await query.order('name', {
      ascending: true,
    });

    if (devicesError) {
      throw new InternalServerErrorException('Failed to fetch devices');
    }

    if (!devices || devices.length === 0) {
      throw new NotFoundException('No devices found for this location');
    }

    return devices as DeviceRecord[];
  }

  public async findLatestData(
    user: AuthenticatedUser,
    devEui: string,
    primaryAndSecondaryOnly = false,
  ) {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    let deviceQuery = client
      .from('cw_devices')
      .select('*, owner_match:cw_device_owners()')
      .eq('dev_eui', normalizedDevEui);

    deviceQuery = this.applyDeviceReadScope(deviceQuery, userId, isGlobalUser);

    const { data: device, error: deviceError } =
      (await deviceQuery.single()) as SingleResult<DeviceRecord>;

    if (deviceError) {
      throw new InternalServerErrorException('Failed to fetch device');
    }

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const { data: deviceType, error: deviceTypeError } = (await client
      .from('cw_device_type')
      .select('*')
      .eq('id', device.type)
      .maybeSingle()) as SingleResult<DeviceTypeRow>;

    if (deviceTypeError) {
      throw new InternalServerErrorException('Failed to fetch device type');
    }

    if (!deviceType) {
      throw new NotFoundException('Device type not found');
    }

    const { data: latestData, error: dataError } = (await client
      .from(deviceType.data_table_v2)
      .select('*')
      .eq('dev_eui', normalizedDevEui)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()) as SingleResult<SensorDataRow>;

    if (dataError) {
      throw new InternalServerErrorException('Failed to fetch latest data');
    }

    if (!latestData) {
      throw new NotFoundException('Latest data not found');
    }

    if (primaryAndSecondaryOnly) {
      const primaryField = deviceType.primary_data_v2;
      const secondaryField = deviceType.secondary_data_v2;
      if (!primaryField && !secondaryField) {
        throw new NotFoundException(
          'Primary or secondary data field not defined for this device type',
        );
      }
      return {
        dev_eui: normalizedDevEui,
        device_type: deviceType.name,
        created_at: device.last_data_updated_at ?? device.created_at,
        lastUpdated: device.last_data_updated_at,
        upload_interval:
          device.upload_interval ?? deviceType.default_upload_interval,
        location_id: device.location_id,
        [primaryField]: latestData[primaryField],
        [secondaryField]: latestData[secondaryField],
        // humidity: latestData.humidity,
      };
    }

    return latestData;
  }

  public async createDevice(
    user: AuthenticatedUser,
    devEui: string,
    device: CreateDeviceDto,
  ) {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    // do I own the location?
    if (!device.location_id) {
      throw new BadRequestException('location_id is required');
    }
    const location = (await this.locationsService.findOne(
      device.location_id,
      user,
    )) as LocationRow | null;
    if (!location) {
      throw new BadRequestException('Invalid location');
    }
    if (!isGlobalUser && location.owner_id !== userId) {
      throw new UnauthorizedException(
        'You do not have permission to create a device in this location',
      );
    }

    // Creating a device consumes an unassigned license seat (the TTI device
    // quota paywall). CropWatch staff are exempt, mirroring the location gate,
    // but a staff-supplied license_id is still validated and consumed.
    const licenseId = device.license_id ?? null;
    if (!isGlobalUser && !licenseId) {
      throw new ForbiddenException(
        'An available device license is required to create a device.',
      );
    }
    if (licenseId) {
      await this.paymentsService.assertLicenseAvailable(user, licenseId);
    }

    // create the device
    const { data: createdDeviceData, error: createDeviceError } = (await client
      .from('cw_devices')
      .insert({
        dev_eui: normalizedDevEui,
        name: device.name,
        type: device.type,
        upload_interval: device.upload_interval,
        location_id: device.location_id,
        user_id: userId,
      })
      .select('*')
      .single()) as SingleResult<DeviceRow>;

    if (createDeviceError) {
      throw new InternalServerErrorException('Failed to create device');
    }

    /******************************************************************************
     * After creating a new device in a location, all users in that location must get
     * permission to that device, as there is no way to assign permission to a device,
     * only to a location (and the users inside of a location get permission to devices)
     * This makes sense because you can view locations, and all devices inside of them
     * there is no point in having permission to a device, but no permission to view the lcoation
     * as even if you could see a device, you would have no route to get to said device.
     *
     * Let's add permissions for all existing location users here!!!
     *********************************************************************************/

    const { data: locationUsers, error: locationUsersError } = await client
      .from('cw_location_owners')
      .select('user_id')
      .eq('location_id', device.location_id);

    if (locationUsersError) {
      throw new InternalServerErrorException('Failed to fetch location users');
    }

    // REmove YOU from the list of location users to add, as you are already the owner of the device and have all permissions
    if (locationUsers.find((user) => user.user_id === userId)) {
      locationUsers.splice(
        locationUsers.findIndex((user) => user.user_id === userId),
        1,
      );
    }

    // Add permissions for all existing location users
    for (const locationUser of locationUsers) {
      const { error: addPermissionError } = await client
        .from('cw_device_owners')
        .insert({
          dev_eui: normalizedDevEui,
          user_id: locationUser.user_id,
          permission_level: PermissionLevel.DISABLED, // location users opt in per device
        });

      if (addPermissionError) {
        throw new InternalServerErrorException(
          'Failed to add device permissions for location users',
        );
      }
    }

    // Consume the seat immediately so the new device cannot exist unlicensed.
    if (licenseId) {
      await this.paymentsService.assignLicense(user, licenseId, normalizedDevEui);
    }

    return createdDeviceData;
  }

  async replaceDevice(
    user: AuthenticatedUser,
    devEui: string,
    newDevice: CreateDeviceDto,
  ) {
    // Ensure user has access to the device they want to replace
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    let existingDeviceQuery = client
      .from('cw_devices')
      .select(`*, owner_match:cw_device_owners()`)
      .eq('dev_eui', normalizedDevEui);

    existingDeviceQuery = this.applyDeviceManageScope(
      existingDeviceQuery,
      userId,
      isGlobalUser,
      PermissionLevel.ADMIN,
    );

    const { data: device, error: deviceError } =
      (await existingDeviceQuery.single()) as SingleResult<DeviceRecord>;

    if (deviceError) {
      throw new InternalServerErrorException('Failed to fetch device');
    }

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    // We have access to the existing device, lets ensure we have access to the new device.
    let newDeviceQuery = client
      .from('cw_devices')
      .select(`*, owner_match:cw_device_owners()`)
      .eq('dev_eui', normalizedDevEui);

    newDeviceQuery = this.applyDeviceManageScope(
      newDeviceQuery,
      userId,
      isGlobalUser,
      PermissionLevel.ADMIN,
    );

    const { data: newDeviceData, error: newDeviceError } =
      (await newDeviceQuery.single()) as SingleResult<DeviceRecord>;

    if (newDeviceError) {
      throw new InternalServerErrorException('Failed to fetch new device');
    }

    if (!newDeviceData) {
      throw new NotFoundException('New device not found');
    }

    // We have access to both devices, let's now update the existing device with the new device.
    const { data: updatedDeviceData, error: updateDeviceError } = (await client
      .from('cw_devices')
      .update({
        dev_eui: newDevice.dev_eui,
        name: newDevice.name,
        type: newDevice.type,
        upload_interval: newDevice.upload_interval,
        location_id: newDevice.location_id,
      })
      .eq('dev_eui', normalizedDevEui)
      .select('*')
      .single()) as SingleResult<DeviceRow>;

    if (updateDeviceError) {
      throw new InternalServerErrorException('Failed to update device');
    }

    if (!updatedDeviceData) {
      throw new NotFoundException('Device not found');
    }

    return updatedDeviceData;
  }

  async updatePermissionLevel(
    user: AuthenticatedUser,
    devEui: string,
    targetUserEmail: string,
    permissionLevel: number,
  ) {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }
    if (!targetUserEmail) {
      throw new BadRequestException('targetUserEmail is required');
    }
    if (!permissionLevel) {
      throw new BadRequestException('permissionLevel is required');
    }

    // Check we have permission to do the permission update
    let permissionQuery = client
      .from('cw_devices')
      .select('*, owner_match:cw_device_owners()')
      .eq('dev_eui', normalizedDevEui);

    permissionQuery = this.applyDeviceManageScope(
      permissionQuery,
      userId,
      isGlobalUser,
      PermissionLevel.ADMIN,
    );

    const { data: RequestingUserHasPermission, error: deviceError } =
      (await permissionQuery.single()) as SingleResult<DeviceRecord>;

    if (!RequestingUserHasPermission || deviceError) {
      throw new UnauthorizedException(
        'You do not have permission to update this device',
      );
    }

    // Get the user we plan to update permission for

    const { data: targetUser, error: targetUserError } = await client
      .from('profiles')
      .select('id')
      .eq('email', targetUserEmail)
      .single();

    if (!targetUser || targetUserError) {
      throw new UnauthorizedException(
        'You do not have permission to update this device',
      );
    }

    // do the thing
    const { data, error } = (await client
      .from('cw_device_owners')
      .update({ permission_level: permissionLevel })
      .eq('dev_eui', devEui)
      .eq('user_id', targetUser.id)
      .select('*')) as ListResult<DeviceOwnerRow>;

    if (!data || error) {
      throw new BadRequestException(
        'You do not have permission to update this device',
      );
    }

    return data;
  }

  async updateDevice(
    user: AuthenticatedUser,
    devEui: string,
    name: string,
    group: string | null,
    location_id: number,
  ) {
    const client = this.supabaseService.getClient();
    const userId = user.sub;
    const isGlobalUser = user.isStaff;
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }
    if (!name) {
      throw new BadRequestException('Device name is required');
    }
    if (!group) {
      group = null; // allow empty group, but not null/undefined
    }
    if (!location_id) {
      throw new BadRequestException('Device location is required');
    }

    // Check we have permission to do the update
    let permissionQuery = client
      .from('cw_devices')
      .select('*, owner_match:cw_device_owners()')
      .eq('dev_eui', normalizedDevEui);

    permissionQuery = this.applyDeviceManageScope(
      permissionQuery,
      userId,
      isGlobalUser,
      MANAGE_CEILING,
    );

    const { data: RequestingUserHasPermission, error: deviceError } =
      (await permissionQuery.single()) as SingleResult<DeviceRecord>;

    if (!RequestingUserHasPermission || deviceError) {
      throw new UnauthorizedException(
        'You do not have permission to update this device',
      );
    }

    const currentDevice = RequestingUserHasPermission;
    const isMovingLocation =
      Number(currentDevice.location_id) !== Number(location_id);

    // Moving a device hands it over to the destination location:
    //  * the destination location's owner becomes the device owner,
    //  * the mover becomes a device Admin,
    //  * every other member of the destination location starts Disabled,
    //  * all permissions from the previous location are removed.
    let destinationOwnerId: string | null = null;
    let destinationMemberIds: string[] = [];

    if (isMovingLocation) {
      // Adding a device to a location is a location-manage action, so the
      // mover needs owner/Admin/Manager rights on the destination too.
      let destinationQuery = client
        .from('cw_locations')
        .select(
          'location_id, owner_id, owner_match:cw_location_owners(), cw_location_owners(user_id)',
        )
        .eq('location_id', location_id);

      if (!isGlobalUser) {
        destinationQuery = destinationQuery
          .eq('owner_match.user_id', userId)
          .lte('owner_match.permission_level', MANAGE_CEILING)
          .or(`owner_id.eq.${userId},owner_match.not.is.null`);
      }

      const { data: destination, error: destinationError } =
        (await destinationQuery.maybeSingle()) as SingleResult<
          Pick<LocationRow, 'location_id' | 'owner_id'> & {
            cw_location_owners: Pick<LocationOwnerRow, 'user_id'>[] | null;
          }
        >;

      if (destinationError) {
        throw new InternalServerErrorException(
          'Failed to verify the destination location',
        );
      }
      if (!destination) {
        throw new UnauthorizedException(
          'You do not have permission to move this device to that location',
        );
      }

      destinationOwnerId = destination.owner_id ?? null;
      destinationMemberIds = (destination.cw_location_owners ?? [])
        .map((member: { user_id: string | null }) => member.user_id)
        .filter((memberId: string | null): memberId is string =>
          Boolean(memberId),
        );
    }

    const updatePayload: Record<string, unknown> = { name, group, location_id };
    if (isMovingLocation && destinationOwnerId) {
      // Device ownership follows the location owner.
      updatePayload.user_id = destinationOwnerId;
    }

    const { data, error } = (await client
      .from('cw_devices')
      .update(updatePayload)
      .eq('dev_eui', devEui)
      .select('*')) as ListResult<DeviceRow>;

    if (!data || error) {
      throw new BadRequestException('Failed to update device');
    }

    if (isMovingLocation) {
      await this.resetDevicePermissionsForMove(
        client,
        normalizedDevEui,
        userId,
        destinationOwnerId,
        destinationMemberIds,
      );
    }

    return data;
  }

  /**
   * After a device moves to a new location: wipe every permission row from
   * the previous location, grant the mover Admin, and give every other
   * member of the destination location a Disabled row (so the device shows
   * up as opt-in, mirroring createDevice). The destination owner gets no row
   * — ownership via cw_devices.user_id is implicit and outranks all levels.
   */
  private async resetDevicePermissionsForMove(
    client: ReturnType<SupabaseService['getClient']>,
    devEui: string,
    moverId: string,
    destinationOwnerId: string | null,
    destinationMemberIds: string[],
  ): Promise<void> {
    const { error: deleteError } = await client
      .from('cw_device_owners')
      .delete()
      .eq('dev_eui', devEui);

    if (deleteError) {
      throw new InternalServerErrorException(
        'Failed to remove device permissions from the previous location',
      );
    }

    const levelByUserId = new Map<string, number>();
    for (const memberId of destinationMemberIds) {
      if (memberId === destinationOwnerId) continue;
      levelByUserId.set(memberId, PermissionLevel.DISABLED);
    }
    if (moverId && moverId !== destinationOwnerId) {
      levelByUserId.set(moverId, PermissionLevel.ADMIN);
    }

    if (levelByUserId.size === 0) {
      return;
    }

    const { error: insertError } = await client.from('cw_device_owners').insert(
      Array.from(levelByUserId, ([user_id, permission_level]) => ({
        dev_eui: devEui,
        user_id,
        permission_level,
      })),
    );

    if (insertError) {
      throw new InternalServerErrorException(
        'Failed to grant device permissions for the new location',
      );
    }
  }

  private applyDeviceReadScope<Q extends DeviceScopeQuery<Q>>(
    query: Q,
    userId: string,
    isGlobalUser: boolean,
  ): Q {
    if (isGlobalUser) {
      return query;
    }

    return query
      .eq('owner_match.user_id', userId)
      .lt('owner_match.permission_level', READ_EXCLUSIVE_CEILING)
      .or(`user_id.eq.${userId},owner_match.not.is.null`);
  }

  private applyDeviceManageScope<Q extends DeviceScopeQuery<Q>>(
    query: Q,
    userId: string,
    isGlobalUser: boolean,
    maxPermissionLevel: number,
  ): Q {
    if (isGlobalUser) {
      return query;
    }

    return query
      .eq('owner_match.user_id', userId)
      .lte('owner_match.permission_level', maxPermissionLevel)
      .or(`user_id.eq.${userId},owner_match.not.is.null`);
  }
}

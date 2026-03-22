import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import type { TableRow } from '../types/supabase';
import {
  getAccessToken,
  getUserId,
  isCropwatchStaff,
} from '../../supabase/supabase-token.helper';
import { LocationsService } from '../locations/locations.service';
import { CreateDeviceDto } from './dto/create-device.dto';

export interface PagedDevicesResponse<T> {
  total?: number;
  skip: number;
  take: number;
  data: T[];
}

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(private readonly supabaseService: SupabaseService, private readonly locationsService: LocationsService) { }

  async findAll(
    jwtPayload: any,
    authHeader: string,
    skip: number = 0,
    take?: number,
    searchGroup?: string,
    searchName?: string,
    searchLocation?: string,
  ): Promise<PagedDevicesResponse<TableRow<'cw_devices'>>> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    let devicesQuery = client
      .from('cw_devices')
      .select(
        `
    *,
    owner_match:cw_device_owners(),
    cw_device_owners(*)
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
      devicesQuery = devicesQuery.ilike('name', `%${searchName}%`);
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

    const responseTake =
      typeof take === 'number' ? take : (count ?? data?.length ?? 0);

    return {
      total: count ?? 0,
      skip,
      take: responseTake,
      data: data ?? [],
    };
  }

  async findOne(
    jwtPayload: any,
    devEui: string,
    authHeader: string,
  ): Promise<TableRow<'cw_devices'>> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
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

    const { data, error } = await query
      .order('name', { ascending: true })
      .single();

    if (error) {
      throw new InternalServerErrorException('Failed to fetch device');
    }

    if (!data) {
      throw new NotFoundException('Device not found');
    }

    return data;
  }

  public async findAllStatus(
    jwtPayload: any,
    authHeader: string,
  ): Promise<{ online: number; offline: number }> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    let query = client
      .from('cw_devices')
      .select(
        'owner_match:cw_device_owners(), last_data_updated_at, upload_interval, cw_device_type(default_upload_interval)',
      );

    query = this.applyDeviceReadScope(query, userId, isGlobalUser);

    const { data: devices, error: devicesError } = await query.order('name', { ascending: true });

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
    jwtPayload: any,
    authHeader: string,
  ): Promise<{ group: string | null; count: number }[]> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

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

    const groupCounts = groups.reduce(
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

  public async findAllDeviceTypes(
    jwtPayload: any,
    authHeader: string,
  ): Promise<{ type: string | null; count: number }[]> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);

    const { data: types, error } = await client
      .from('cw_device_type')
      .select('*');

    if (error) {
      throw new InternalServerErrorException('Failed to fetch device types');
    }

    if (!types || types.length === 0) {
      throw new NotFoundException('No device types found');
    }

    return types;
  }

  public async findData(
    jwtPayload: any,
    devEui: string,
    skip: number = 0,
    take: number = 144,
    authHeader: string,
  ): Promise<PagedDevicesResponse<any>> {
    this.logger.log(
      `findData called: devEui=${devEui}, skip=${skip}, take=${take}`,
    );

    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
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

    const { data: device, error: deviceError } = await deviceQuery.single();

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
    const { data: deviceType, error: deviceTypeError } = await client
      .from('cw_device_type')
      .select('*')
      .eq('id', device.type)
      .maybeSingle();

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
    const { data: latestData, error: dataError } = await client
      .from(dataTable)
      .select(`${getAnnotations}`)
      .eq('dev_eui', normalizedDevEui)
      .order('created_at', { ascending: false })
      .range(skip, skip + take - 1)
      .limit(take);

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
    jwtPayload: any,
    devEui: string,
    authHeader: string,
    start: Date | string = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString(),
    end: Date | string = new Date().toISOString(),
    skip: number = 0,
    take: number = 144,
  ): Promise<PagedDevicesResponse<any>> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    let deviceQuery = client
      .from('cw_devices')
      .select(
        `*, owner_match:cw_device_owners(), cw_device_owners(*)`,
      )
      .eq('dev_eui', normalizedDevEui);

    deviceQuery = this.applyDeviceReadScope(deviceQuery, userId, isGlobalUser);

    const { data: device, error: deviceError } = await deviceQuery.single();

    if (deviceError) {
      console.error(deviceError);
      throw new InternalServerErrorException('Failed to fetch device');
    }

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const { data: deviceType, error: deviceTypeError } = await client
      .from('cw_device_type')
      .select('*')
      .eq('id', device.type)
      .maybeSingle();

    if (deviceTypeError) {
      throw new InternalServerErrorException('Failed to fetch device type');
    }

    if (!deviceType) {
      throw new NotFoundException('Device type not found');
    }

    const startDate = new Date(start).toISOString();
    const endDate = new Date(end).toISOString();

    const {
      data: latestData,
      count,
      error: dataError,
    } = await client
      .from(deviceType.data_table_v2)
      .select('*')
      .eq('dev_eui', normalizedDevEui)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false })
      .range(skip, skip + take - 1);

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
    jwtPayload: any,
    skip: number = 0,
    take: number = 10,
    authHeader: string,
    searchGroup?: string,
    searchName?: string,
    searchLocation?: string,
    locationGroup?: string,
  ): Promise<PagedDevicesResponse<any>> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
    const hasLocationFilter =
      typeof searchLocation === 'string' && searchLocation.trim().length > 0;
    const locationIdFilter = hasLocationFilter
      ? Number(searchLocation)
      : undefined;
    const countLocationSelect = hasLocationFilter
      ? 'cw_locations!inner(location_id, name, group)'
      : 'cw_locations(location_id, name, group)';
    const dataLocationSelect = hasLocationFilter
      ? 'cw_locations!inner(location_id, name, group)'
      : 'cw_locations(location_id, name, group)';

    let devicesQuery = client
      .from('cw_devices')
      .select(
        `dev_eui, name, group, location_id, cw_rules(*), cw_device_type(name, primary_data_v2, secondary_data_v2, data_table_v2), ${dataLocationSelect}, owner_match:cw_device_owners()`,
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
      devicesQuery = devicesQuery.ilike('name', `%${searchName}%`);
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

    const devicesWithLatestData = (
      await Promise.all(
        device.map(async (d) => {
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

          const { data: latestData, error: dataError } = await client
            .from(deviceType.data_table_v2)
            .select(Array.from(latestFields).join(', '))
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
            created_at: latestRow.created_at,
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
    jwtPayload: any,
    locationId: number,
    authHeader: string,
  ): Promise<TableRow<'cw_devices'>[]> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    let query = client
      .from('cw_devices')
      .select('*, owner_match:cw_device_owners()')
      .eq('location_id', locationId);

    query = this.applyDeviceReadScope(query, userId, isGlobalUser);

    const { data: devices, error: devicesError } = await query.order('name', { ascending: true });

    if (devicesError) {
      throw new InternalServerErrorException('Failed to fetch devices');
    }

    if (!devices || devices.length === 0) {
      throw new NotFoundException('No devices found for this location');
    }

    return devices;
  }

  public async findLatestData(
    jwtPayload: any,
    devEui: string,
    authHeader: string,
    primaryAndSecondaryOnly = false,
  ) {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    let deviceQuery = client
      .from('cw_devices')
      .select('*, owner_match:cw_device_owners()')
      .eq('dev_eui', normalizedDevEui);

    deviceQuery = this.applyDeviceReadScope(deviceQuery, userId, isGlobalUser);

    const { data: device, error: deviceError } = await deviceQuery.single();

    if (deviceError) {
      throw new InternalServerErrorException('Failed to fetch device');
    }

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const { data: deviceType, error: deviceTypeError } = await client
      .from('cw_device_type')
      .select('*')
      .eq('id', device.type)
      .maybeSingle();

    if (deviceTypeError) {
      throw new InternalServerErrorException('Failed to fetch device type');
    }

    if (!deviceType) {
      throw new NotFoundException('Device type not found');
    }

    const { data: latestData, error: dataError } = await client
      .from(deviceType.data_table_v2)
      .select('*')
      .eq('dev_eui', normalizedDevEui)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dataError) {
      throw new InternalServerErrorException('Failed to fetch latest data');
    }

    if (!latestData) {
      throw new NotFoundException('Latest data not found');
    }

    if (primaryAndSecondaryOnly) {
      const primaryField = deviceType.primary_data_v2;
      const secondaryField = deviceType.secondary_data_v2;
      if (!primaryField || !secondaryField) {
        throw new NotFoundException(
          'Primary or secondary data field not defined for this device type',
        );
      }
      return {
        dev_eui: normalizedDevEui,
        device_type: deviceType.name,
        created_at: latestData.created_at,
        location_id: device.location_id,
        [primaryField]: latestData[primaryField],
        [secondaryField]: latestData[secondaryField],
        humidity: latestData.humidity,
      };
    }

    return latestData;
  }

  public async createDevice(
    jwtPayload: any,
    devEui: string,
    device: CreateDeviceDto,
    authHeader: string,
  ) {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    // do I own the location?
    if (!device.location_id) {
      throw new BadRequestException('location_id is required');
    }
    const location = await this.locationsService.findOne(device.location_id, jwtPayload, authHeader);
    if (!location) {
      throw new BadRequestException('Invalid location');
    }
    if (!isGlobalUser && location.owner_id !== userId) {
      throw new UnauthorizedException('You do not have permission to create a device in this location');
    }

    // create the device
    const { data: createdDeviceData, error: createDeviceError } = await client
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
      .single();

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
    if (locationUsers.find(user => user.user_id === userId)) {
      locationUsers.splice(locationUsers.findIndex(user => user.user_id === userId), 1);
    }

    // Add permissions for all existing location users
    for (const locationUser of locationUsers) {
      const { error: addPermissionError } = await client
        .from('cw_device_owners')
        .insert({
          dev_eui: normalizedDevEui,
          user_id: locationUser.user_id,
          permission_level: 4, // default permission level
        });

      if (addPermissionError) {
        throw new InternalServerErrorException('Failed to add device permissions for location users');
      }
    }

    return createdDeviceData;
  }

  async replaceDevice(
    jwtPayload: any,
    devEui: string,
    newDevice: CreateDeviceDto,
    authHeader: string,
  ) {
    // Ensure user has access to the device they want to replace
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
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
      1,
    );

    const { data: device, error: deviceError } = await existingDeviceQuery.single();

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
      1,
    );

    const { data: newDeviceData, error: newDeviceError } = await newDeviceQuery.single();

    if (newDeviceError) {
      throw new InternalServerErrorException('Failed to fetch new device');
    }

    if (!newDeviceData) {
      throw new NotFoundException('New device not found');
    }

    // We have access to both devices, let's now update the existing device with the new device.
    const { data: updatedDeviceData, error: updateDeviceError } = await client
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
      .single();

    if (updateDeviceError) {
      throw new InternalServerErrorException('Failed to update device');
    }

    if (!updatedDeviceData) {
      throw new NotFoundException('Device not found');
    }

    return updatedDeviceData;
  }

  async updatePermissionLevel(
    jwtPayload: any,
    devEui: string,
    targetUserEmail: string,
    permissionLevel: number,
    authHeader: string,
  ) {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
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
      1,
    );

    const { data: RequestingUserHasPermission, error: deviceError } =
      await permissionQuery.single();

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
    const { data, error } = await client
      .from('cw_device_owners')
      .update({ permission_level: permissionLevel })
      .eq('dev_eui', devEui)
      .eq('user_id', targetUser.id)
      .select('*');

    if (!data || error) {
      throw new BadRequestException(
        'You do not have permission to update this device',
      );
    }

    return data;
  }

  async updateDevice(
    jwtPayload: any,
    devEui: string,
    name: string,
    group: string | null,
    location_id: number,
    authHeader: string,
  ) {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
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
      2,
    );

    const { data: RequestingUserHasPermission, error: deviceError } =
      await permissionQuery.single();

    if (!RequestingUserHasPermission || deviceError) {
      throw new UnauthorizedException(
        'You do not have permission to update this device',
      );
    }

    // do the thing
    const { data, error } = await client
      .from('cw_devices')
      .update({ name, group, location_id })
      .eq('dev_eui', devEui)
      .select('*');

    if (!data || error) {
      throw new BadRequestException('Failed to update device');
    }

    return data;
  }

  private applyDeviceReadScope(query: any, userId: string, isGlobalUser: boolean) {
    if (isGlobalUser) {
      return query;
    }

    return query
      .eq('owner_match.user_id', userId)
      .lt('owner_match.permission_level', 4)
      .or(`user_id.eq.${userId},owner_match.not.is.null`);
  }

  private applyDeviceManageScope(
    query: any,
    userId: string,
    isGlobalUser: boolean,
    maxPermissionLevel: number,
  ) {
    if (isGlobalUser) {
      return query;
    }

    return query
      .eq('owner_match.user_id', userId)
      .lte('owner_match.permission_level', maxPermissionLevel)
      .or(`user_id.eq.${userId},owner_match.not.is.null`);
  }
}

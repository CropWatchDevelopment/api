import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import type { TableRow } from '../types/supabase';
import { getAccessToken, getUserId } from 'src/supabase/supabase-token.helper';

export interface PagedDevicesResponse<T> {
  total: number;
  skip: number;
  take: number;
  data: T[];
}

@Injectable()
export class DevicesService {

  constructor(private readonly supabaseService: SupabaseService) { }

  async findAll(
    jwtPayload: any,
    authHeader: string,
    skip: number = 0,
    take?: number,
  ): Promise<PagedDevicesResponse<TableRow<'cw_devices'>>> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);

    const { count, error: countError } = await client
      .from('cw_devices')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) {
      throw new InternalServerErrorException('Failed to fetch devices');
    }

    const resolvedTake = typeof take === 'number' ? take : (count ?? 0);

    let devicesQuery = client
      .from('cw_devices')
      .select(`
    *,
    owner_match:cw_device_owners(),
    cw_device_owners(*)
  `)
      .eq('owner_match.user_id', userId)
      .gt('owner_match.permission_level', 4)
      .or(`user_id.eq.${userId},owner_match.not.is.null`)
      .order('name', { ascending: true });

    if (resolvedTake > 0) {
      devicesQuery = devicesQuery
        .range(skip, skip + resolvedTake - 1)
        .limit(resolvedTake);
    }

    const { data, error } = await devicesQuery;

    if (error) {
      throw new InternalServerErrorException('Failed to fetch devices');
    }

    const responseTake = typeof take === 'number' ? take : (count ?? data?.length ?? 0);

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
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    let { data, error } = await client
      .from('cw_devices')
      .select(`
    *,
    owner_match:cw_device_owners(),
    cw_device_owners(*)
  `)
      .eq('dev_eui', normalizedDevEui)
      .eq('owner_match.user_id', userId)
      .gt('owner_match.permission_level', 4)
      .or(`user_id.eq.${userId},owner_match.not.is.null`)
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

  public async findAllStatus(jwtPayload: any, authHeader: string): Promise<{ online: number; offline: number }> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);

    const { data: devices, error: devicesError } = await client
      .from('cw_devices')
      .select('owner_match:cw_device_owners(), last_data_updated_at, upload_interval, cw_device_type(default_upload_interval)')
      .eq('owner_match.user_id', userId)
      .gt('owner_match.permission_level', 4)
      .or(`user_id.eq.${userId},owner_match.not.is.null`)
      .order('name', { ascending: true });

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
      const minutesSinceLastUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60);
      const deviceType = Array.isArray(device.cw_device_type)
        ? device.cw_device_type[0]
        : device.cw_device_type;
      if (minutesSinceLastUpdate <= (device.upload_interval ? device.upload_interval : (deviceType?.default_upload_interval as number))) {
        onlineCount++;
      } else {
        offlineCount++;
      }
    });

    return { online: onlineCount, offline: offlineCount };
  }

  public async findData(
    jwtPayload: any,
    devEui: string,
    skip: number = 0,
    take: number = 144,
    authHeader: string,
  ): Promise<PagedDevicesResponse<any>> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const { data: device, error: deviceError } = await client
      .from('cw_devices')
      .select(`
    *,
    owner_match:cw_device_owners(),
    cw_device_owners(*)
  `)
      .eq('owner_match.user_id', userId)
      .gt('owner_match.permission_level', 4)
      .or(`user_id.eq.${userId},owner_match.not.is.null`)
      .eq('dev_eui', normalizedDevEui)
      .single();

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

    const { count, error: countError } = await client
      .from(deviceType.data_table_v2)
      .select('*', { count: 'exact', head: true })
      .eq('dev_eui', normalizedDevEui);

    if (countError) {
      throw new InternalServerErrorException('Failed to fetch Data');
    }

    const { data: latestData, error: dataError } = await client
      .from(deviceType.data_table_v2)
      .select('*')
      .eq('dev_eui', normalizedDevEui)
      .order('created_at', { ascending: false })
      .range(skip, skip + take - 1)
      .limit(take);

    if (dataError) {
      throw new InternalServerErrorException('Failed to fetch Data');
    }

    if (!latestData || latestData.length === 0) {
      throw new NotFoundException('Data not found');
    }

    return {
      total: count ?? 0,
      skip,
      take,
      data: latestData,
    };
  }

  public async findDataWithinRange(
    jwtPayload: any,
    devEui: string,
    authHeader: string,
    start: Date | string = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end: Date | string = new Date().toISOString(),
    skip: number = 0,
    take: number = 144,
  ): Promise<PagedDevicesResponse<any>> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const { data: device, error: deviceError } = await client
      .from('cw_devices')
      .select(`
    *,
    owner_match:cw_device_owners(),
    cw_device_owners(*)
  `)
      .eq('owner_match.user_id', userId)
      .gt('owner_match.permission_level', 4)
      .or(`user_id.eq.${userId},owner_match.not.is.null`)
      .eq('dev_eui', normalizedDevEui)
      .single();

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

    const startDate = new Date(start);
    const endDate = new Date(end);

    const { count, error: countError } = await client
      .from(deviceType.data_table_v2)
      .select('*', { count: 'exact', head: true })
      .eq('dev_eui', normalizedDevEui)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (countError) {
      throw new InternalServerErrorException('Failed to fetch Data');
    }

    const { data: latestData, error: dataError } = await client
      .from(deviceType.data_table_v2)
      .select('*')
      .eq('dev_eui', normalizedDevEui)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false })
      .range(skip, skip + take - 1);

    if (dataError) {
      throw new InternalServerErrorException('Failed to fetch Data');
    }

    if (!latestData || latestData.length === 0) {
      throw new NotFoundException('Data not found');
    }

    return {
      total: count ?? 0,
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
  ): Promise<PagedDevicesResponse<any>> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);

    const { count, error: countError } = await client
      .from('cw_devices')
      .select('*, owner_match:cw_device_owners()', { count: 'exact', head: true })
      .eq('owner_match.user_id', userId)
      .gt('owner_match.permission_level', 4)
      .or(`user_id.eq.${userId},owner_match.not.is.null`)
      .order('name', { ascending: true });

    if (countError) {
      throw new InternalServerErrorException('Failed to fetch device');
    }

    const { data: device, error: deviceError } = await client
      .from('cw_devices')
      .select('*, cw_device_type(*), cw_locations(name), owner_match:cw_device_owners()')
      .eq('owner_match.user_id', userId)
      .gt('owner_match.permission_level', 4)
      .or(`user_id.eq.${userId},owner_match.not.is.null`)
      .range(skip, skip + take - 1)
      .limit(take)
      .order('name', { ascending: false });

    if (deviceError) {
      throw new InternalServerErrorException('Failed to fetch device');
    }

    if (!device) {
      throw new NotFoundException('Device not found');
    }
    if (device.length === 0) {
      throw new NotFoundException('No devices found');
    }

    const devicesWithLatestData = await Promise.all(
      device.map(async (d) => {
        const deviceType = d.cw_device_type;
        if (!deviceType) {
          throw new NotFoundException(`Device type not found for device ${d.dev_eui}`);
        }
        const { data: latestData, error: dataError } = await client
          .from(deviceType.data_table_v2)
          .select('*')
          .eq('dev_eui', d.dev_eui)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (dataError) {
          throw new InternalServerErrorException(`Failed to fetch latest data for device ${d.dev_eui}`);
        }

        const primaryField = deviceType.primary_data_v2;
        const secondaryField = deviceType.secondary_data_v2;
        return {
          dev_eui: d.dev_eui,
          name: d.name,
          location_name: d.cw_locations?.name ?? 'n/a',
          created_at: latestData.created_at,
          [primaryField]: latestData[primaryField],
          [secondaryField]: latestData[secondaryField],
          // if humidity, add it here
          humidity: latestData.humidity,
        };
      })
    );

    return {
      total: count ?? 0,
      skip,
      take,
      data: devicesWithLatestData,
    };
  }

  public async findAllDevicesInLocation(jwtPayload: any, locationId: number, authHeader: string): Promise<TableRow<'cw_devices'>[]> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);

    const { data: devices, error: devicesError } = await client
      .from('cw_devices')
      .select('*, owner_match:cw_device_owners()')
      .eq('location_id', locationId)
      .eq('owner_match.user_id', userId)
      .gt('owner_match.permission_level', 4)
      .or(`user_id.eq.${userId},owner_match.not.is.null`)
      .order('name', { ascending: true });

    if (devicesError) {
      throw new InternalServerErrorException('Failed to fetch devices');
    }

    if (!devices || devices.length === 0) {
      throw new NotFoundException('No devices found for this location');
    }

    return devices;
  }

  public async findLatestData(jwtPayload: any, devEui: string, authHeader: string, primaryAndSecondaryOnly = false) {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const { data: device, error: deviceError } = await client
      .from('cw_devices')
      .select('*, owner_match:cw_device_owners()')
      .eq('owner_match.user_id', userId)
      .gt('owner_match.permission_level', 4)
      .or(`user_id.eq.${userId},owner_match.not.is.null`)
      .eq('dev_eui', normalizedDevEui)
      .single();

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
        throw new NotFoundException('Primary or secondary data field not defined for this device type');
      }
      return {
        dev_eui: normalizedDevEui,
        created_at: latestData.created_at,
        [primaryField]: latestData[primaryField],
        [secondaryField]: latestData[secondaryField],
        humidity: latestData.humidity,
      };
    }

    return latestData;
  }
}

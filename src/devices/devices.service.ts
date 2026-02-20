import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { TableRow } from '../types/supabase';

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
    const accessToken = this.getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = this.getUserId(jwtPayload);

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
      .select('*')
      .eq('user_id', userId)
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
    const accessToken = this.getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = this.getUserId(jwtPayload);
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const { data, error } = await client
      .from('cw_devices')
      .select('*')
      .eq('user_id', userId)
      .eq('dev_eui', normalizedDevEui)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to fetch device');
    }

    if (!data) {
      throw new NotFoundException('Device not found');
    }

    return data;
  }

  public async findData(
    jwtPayload: any,
    devEui: string,
    skip: number = 0,
    take: number = 144,
    authHeader: string,
  ): Promise<PagedDevicesResponse<any>> {
    const accessToken = this.getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = this.getUserId(jwtPayload);
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const { data: device, error: deviceError } = await client
      .from('cw_devices')
      .select('*')
      .eq('user_id', userId)
      .eq('dev_eui', normalizedDevEui)
      .maybeSingle();

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
    const accessToken = this.getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = this.getUserId(jwtPayload);
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const { data: device, error: deviceError } = await client
      .from('cw_devices')
      .select('*')
      .eq('user_id', userId)
      .eq('dev_eui', normalizedDevEui)
      .maybeSingle();

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
    const accessToken = this.getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = this.getUserId(jwtPayload);

    const { count, error: countError } = await client
      .from('cw_devices')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) {
      throw new InternalServerErrorException('Failed to fetch device');
    }

    const { data: device, error: deviceError } = await client
      .from('cw_devices')
      .select('*, cw_device_type(*), cw_locations(name)')
      .eq('user_id', userId)
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

  public async findLatestData(jwtPayload: any, devEui: string, authHeader: string, primaryAndSecondaryOnly = false) {
    const accessToken = this.getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = this.getUserId(jwtPayload);
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const { data: device, error: deviceError } = await client
      .from('cw_devices')
      .select('*')
      .eq('user_id', userId)
      .eq('dev_eui', normalizedDevEui)
      .maybeSingle();

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
      };
    }

    return latestData;
  }

  /*********************************************************************
 * 
 * Private functions to handle common tasks such as extracting user ID from JWT payload,
 * 
 ********************************************************************/

  private getUserId(jwtPayload: any): string {
    const userId = jwtPayload?.sub;
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new UnauthorizedException('Invalid bearer token');
    }
    return userId;
  }

  private getAccessToken(authHeader: string): string {
    const rawHeader = authHeader?.trim() ?? '';
    const [scheme, token] = rawHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    return token;
  }
}

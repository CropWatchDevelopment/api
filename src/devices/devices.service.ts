import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { TableRow } from '../types/supabase';

@Injectable()
export class DevicesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll(jwtPayload: any): Promise<TableRow<'cw_devices'>[]> {
    const userId = this.getUserId(jwtPayload);
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('cw_devices')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to fetch devices');
    }

    return data ?? [];
  }

  async findOne(
    jwtPayload: any,
    devEui: string,
  ): Promise<TableRow<'cw_devices'>> {
    const userId = this.getUserId(jwtPayload);
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const client =
      this.supabaseService.getAdminClient() ?? this.supabaseService.getClient();
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

  private getUserId(jwtPayload: any): string {
    const userId = jwtPayload?.sub;
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new UnauthorizedException('Invalid bearer token');
    }
    return userId;
  }
}

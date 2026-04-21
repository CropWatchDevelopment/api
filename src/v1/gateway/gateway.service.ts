import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateGatewayDto } from './dto/create-gateway.dto';
import { UpdateGatewayDto } from './dto/update-gateway.dto';
import { SupabaseService } from '../../supabase/supabase.service';
import { getUserId } from '../../supabase/supabase-token.helper';
import type { TableRow } from '../types/supabase';

@Injectable()
export class GatewayService {
  constructor(private readonly supabaseService: SupabaseService) {}

  create(createGatewayDto: CreateGatewayDto) {
    void createGatewayDto;
    return 'This action adds a new gateway';
  }

  async findAll(jwtPayload: any): Promise<TableRow<'cw_gateways'>[]> {
    const client = this.supabaseService.getClient();
    const userId = getUserId(jwtPayload);

    const { data, error } = await client
      .from('cw_gateways')
      .select(
        `
        *,
        owner_match:cw_gateways_owners!inner(),
        cw_gateways_owners(*)
      `,
      )
      .eq('owner_match.user_id', userId)
      .order('gateway_name', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to fetch gateways');
    }

    return data ?? [];
  }

  async findOne(
    gatewayIdentifier: string,
    jwtPayload: any,
  ): Promise<TableRow<'cw_gateways'>> {
    const normalizedGatewayIdentifier = gatewayIdentifier?.trim();
    if (!normalizedGatewayIdentifier) {
      throw new BadRequestException('gateway_id is required');
    }

    const client = this.supabaseService.getClient();
    const userId = getUserId(jwtPayload);

    const query = client
      .from('cw_gateways')
      .select(
        `
        *,
        cw_gateways_owners(*)
      `,
      )
      .eq('gateway_id', normalizedGatewayIdentifier);

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to fetch gateway');
    }

    if (!data) {
      throw new NotFoundException('Gateway not found');
    }

    const isOwner = data.cw_gateways_owners?.some(
      (o: any) => o.user_id === userId,
    );
    if (!data.is_public && !isOwner) {
      throw new NotFoundException('Gateway not found');
    }

    return data;
  }

  update(id: number, updateGatewayDto: UpdateGatewayDto) {
    void updateGatewayDto;
    return `This action updates a #${id} gateway`;
  }

  remove(id: number) {
    return `This action removes a #${id} gateway`;
  }
}

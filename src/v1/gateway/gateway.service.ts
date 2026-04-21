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

    const { data: ownedGateways, error: ownedGatewaysError } = await client
      .from('cw_gateways')
      .select('*, cw_gateways_owners(*)')
      .eq('cw_gateways_owners.user_id', userId);

    const { data: publicGateways, error: publicGatewaysError } = await client
      .from('cw_gateways')
      .select('*')
      .eq('is_public', true);

    if (ownedGatewaysError || publicGatewaysError) {
      throw new InternalServerErrorException('Failed to fetch gateways');
    }

    const ownedGatewayIds = new Set(
      ownedGateways?.map((og) => og.gateway_id) ?? [],
    );

    const allGateways = [
      ...(ownedGateways ?? []).map((og) => ({ id: og.id, gateway_id: og.gateway_id, is_online: og.is_online, is_public: og.is_public, gateway_name: og.gateway_name, updated_at: og.updated_at })),
      ...(publicGateways ?? []).filter((pg) => !ownedGatewayIds.has(pg.gateway_id)),
    ];


    return allGateways ?? [];
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

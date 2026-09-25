import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import type { TableRow } from '../types/supabase';
import type { AuthenticatedUser } from '../auth/authenticated-user';

type GatewayRow = TableRow<'cw_gateways'>;
type GatewayOwnerRow = TableRow<'cw_gateways_owners'>;
type GatewayRecord = GatewayRow & {
  cw_gateways_owners?: GatewayOwnerRow[];
};
type GatewayListItem = Pick<
  GatewayRow,
  | 'id'
  | 'gateway_id'
  | 'is_online'
  | 'is_public'
  | 'gateway_name'
  | 'updated_at'
>;
type QueryResult<T> = { data: T | null; error: PostgrestError | null };

@Injectable()
export class GatewayService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll(user: AuthenticatedUser): Promise<GatewayListItem[]> {
    const client = this.supabaseService.getClient();
    const userId = user.sub;

    // Staff bypass scoping, like every other resource in the API.
    if (user.isStaff) {
      const { data: allGateways, error: allGatewaysError } = await client
        .from('cw_gateways')
        .select('*');
      if (allGatewaysError) {
        throw new InternalServerErrorException('Failed to fetch gateways');
      }
      return ((allGateways ?? []) as GatewayRow[]).map((gw) => ({
        id: gw.id,
        gateway_id: gw.gateway_id,
        is_online: gw.is_online,
        is_public: gw.is_public,
        gateway_name: gw.gateway_name,
        updated_at: gw.updated_at,
      }));
    }

    const { data: ownedGateways, error: ownedGatewaysError } = await client
      .from('cw_gateways')
      .select('*, cw_gateways_owners!inner(*)')
      .eq('cw_gateways_owners.user_id', userId);

    const { data: publicGateways, error: publicGatewaysError } = await client
      .from('cw_gateways')
      .select('*')
      .eq('is_public', true);

    if (ownedGatewaysError || publicGatewaysError) {
      throw new InternalServerErrorException('Failed to fetch gateways');
    }

    const ownedRows = (ownedGateways ?? []) as GatewayRecord[];
    const publicRows = (publicGateways ?? []) as GatewayRow[];

    const ownedGatewayIds = new Set(ownedRows.map((og) => og.gateway_id));

    const allGateways: GatewayListItem[] = [
      ...ownedRows.map((og) => ({
        id: og.id,
        gateway_id: og.gateway_id,
        is_online: og.is_online,
        is_public: og.is_public,
        gateway_name: og.gateway_name,
        updated_at: og.updated_at,
      })),
      ...publicRows.filter((pg) => !ownedGatewayIds.has(pg.gateway_id)),
    ];

    return allGateways;
  }

  async findOne(
    gatewayIdentifier: string,
    user: AuthenticatedUser,
  ): Promise<GatewayRow> {
    const normalizedGatewayIdentifier = gatewayIdentifier?.trim();
    if (!normalizedGatewayIdentifier) {
      throw new BadRequestException('gateway_id is required');
    }

    const client = this.supabaseService.getClient();
    const userId = user.sub;

    const query = client
      .from('cw_gateways')
      .select(
        `
        *,
        cw_gateways_owners(*)
      `,
      )
      .eq('gateway_id', normalizedGatewayIdentifier);

    const { data, error } =
      (await query.maybeSingle()) as QueryResult<GatewayRecord>;

    if (error) {
      throw new InternalServerErrorException('Failed to fetch gateway');
    }

    if (!data) {
      throw new NotFoundException('Gateway not found');
    }

    // Staff bypass scoping, like every other resource in the API.
    const isOwner = data.cw_gateways_owners?.some((o) => o.user_id === userId);
    if (!data.is_public && !isOwner && !user.isStaff) {
      throw new NotFoundException('Gateway not found');
    }

    return data;
  }
}

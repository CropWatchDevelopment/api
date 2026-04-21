import { ApiProperty } from '@nestjs/swagger';
import type { TableRow } from '../../types/supabase';
import { GatewayOwnerDto } from './gateway-owner.dto';

export class GatewayDto implements TableRow<'cw_gateways'> {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ description: 'The external gateway identifier.' })
  gateway_id: string;

  @ApiProperty({ description: 'Gateway display name.' })
  gateway_name: string;

  @ApiProperty({ description: 'Internal gateway row id.' })
  id: number;

  @ApiProperty()
  is_online: boolean;

  @ApiProperty()
  is_public: boolean;

  @ApiProperty({ required: false, nullable: true, format: 'date-time' })
  updated_at: string | null;

  @ApiProperty({
    type: () => GatewayOwnerDto,
    isArray: true,
    required: false,
    description: 'Rows from cw_gateways_owners linked by cw_gateways.id.',
  })
  cw_gateways_owners?: GatewayOwnerDto[];
}

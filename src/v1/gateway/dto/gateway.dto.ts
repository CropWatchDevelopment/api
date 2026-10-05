import { ApiProperty } from '@nestjs/swagger';
import type { TableRow } from '../../types/supabase';
import { GatewayOwnerDto } from './gateway-owner.dto';

export class GatewayDto implements TableRow<'cw_gateways'> {
  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description:
      'TTI Gateway Server connected_at; null while the gateway is offline (027).',
  })
  connected_at: string | null;

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

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'Newest uplink received through this gateway (027).',
  })
  last_seen_at: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Owning organization (026)',
  })
  org_id: string | null;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'Last time the gateway status was checked against TTI (027).',
  })
  status_checked_at: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'date-time' })
  updated_at: string | null;

  @ApiProperty({
    type: () => GatewayOwnerDto,
    isArray: true,
    required: false,
    description: 'Rows from cw_gateways_owners linked by cw_gateways.id.',
  })
  cw_gateways_owners?: GatewayOwnerDto[];

  @ApiProperty({
    description:
      'Distinct devices heard through this gateway within the connected window (24 h), counting all devices, not only the ones the caller can read.',
  })
  connected_device_count: number;
}

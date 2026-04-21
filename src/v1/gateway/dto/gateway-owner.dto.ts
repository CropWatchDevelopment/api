import { ApiProperty } from '@nestjs/swagger';
import type { TableRow } from '../../types/supabase';

export class GatewayOwnerDto implements TableRow<'cw_gateways_owners'> {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ description: 'Internal cw_gateways.id value.' })
  gateway_id: number;

  @ApiProperty()
  id: number;

  @ApiProperty({ description: 'Supabase user id.' })
  user_id: string;
}

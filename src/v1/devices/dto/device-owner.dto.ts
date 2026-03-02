import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type DeviceOwnerRow = Database['public']['Tables']['cw_device_owners']['Row'];

export class DeviceOwnerDto implements DeviceOwnerRow {
  @ApiProperty()
  dev_eui: string;

  @ApiProperty({ required: false })
  id: number;

  @ApiProperty()
  owner_id: number;

  @ApiProperty()
  permission_level: number;

  @ApiProperty()
  user_id: string;
}

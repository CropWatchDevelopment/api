import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type DeviceOwnerInsert = Database['public']['Tables']['cw_device_owners']['Insert'];

export class CreateDeviceOwnerDto implements DeviceOwnerInsert {
  @ApiProperty()
  dev_eui: string;

  @ApiProperty()
  user_id: string;

  @ApiProperty({ required: false })
  id?: number;

  @ApiProperty({ required: false })
  owner_id?: number;

  @ApiProperty({ required: false })
  permission_level?: number;
}

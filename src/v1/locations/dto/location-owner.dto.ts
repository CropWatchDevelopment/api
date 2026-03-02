import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type LocationOwnerRow = Database['public']['Tables']['cw_location_owners']['Row'];

export class LocationOwnerDto implements LocationOwnerRow {
  @ApiProperty()
  admin_user_id: string;

  @ApiProperty({ nullable: true, required: false })
  description: string | null;

  @ApiProperty({ required: false })
  id: number;

  @ApiProperty({ nullable: true, required: false })
  is_active: boolean | null;

  @ApiProperty()
  location_id: number;

  @ApiProperty()
  owner_id: number;

  @ApiProperty({ nullable: true, required: false })
  permission_level: number | null;

  @ApiProperty()
  user_id: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type LocationOwnerInsert = Database['public']['Tables']['cw_location_owners']['Insert'];

export class CreateLocationOwnerDto implements LocationOwnerInsert {
  @ApiProperty()
  admin_user_id: string;

  @ApiProperty()
  location_id: number;

  @ApiProperty()
  user_id: string;

  @ApiProperty({ required: false, nullable: true })
  description?: string | null;

  @ApiProperty({ required: false })
  id?: number;

  @ApiProperty({ required: false, nullable: true })
  is_active?: boolean | null;

  @ApiProperty({ required: false })
  owner_id?: number;

  @ApiProperty({ required: false, nullable: true })
  permission_level?: number | null;
}

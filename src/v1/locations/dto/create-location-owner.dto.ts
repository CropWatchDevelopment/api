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

  @ApiProperty({ required: false })
  user_email?: string; // This field is not part of the database schema but will be used to look up the user ID based on the provided email when creating a new location owner record.

  @ApiProperty({ required: false, nullable: true })
  is_active?: boolean | null;

  @ApiProperty({ required: false })
  owner_id?: number;

  @ApiProperty({ required: false, nullable: true })
  permission_level?: number | null;
}

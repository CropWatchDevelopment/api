import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type LocationInsert = Database['public']['Tables']['cw_locations']['Insert'];

export class CreateLocationDto implements LocationInsert {
  @ApiProperty()
  name: string;

  @ApiProperty({ required: false, format: 'date-time' })
  created_at?: string;

  @ApiProperty({ required: false, nullable: true })
  description?: string | null;

  @ApiProperty({ required: false, nullable: true })
  group?: string | null;

  @ApiProperty({ required: false, nullable: true })
  lat?: number | null;

  @ApiProperty({ required: false })
  location_id?: number;

  @ApiProperty({ required: false, nullable: true })
  long?: number | null;

  @ApiProperty({ required: false, nullable: true })
  map_zoom?: number | null;

  @ApiProperty({ required: false, nullable: true })
  owner_id?: string | null;
}

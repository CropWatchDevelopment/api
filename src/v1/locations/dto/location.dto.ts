import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';
import { LocationOwnerDto } from './location-owner.dto';

type LocationRow = Database['public']['Tables']['cw_locations']['Row'];

export class LocationDto implements LocationRow {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ nullable: true, required: false })
  description: string | null;

  @ApiProperty({ nullable: true, required: false })
  group: string | null;

  @ApiProperty({ nullable: true, required: false })
  lat: number | null;

  @ApiProperty()
  location_id: number;

  @ApiProperty({ nullable: true, required: false })
  long: number | null;

  @ApiProperty({ nullable: true, required: false })
  map_zoom: number | null;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, required: false })
  owner_id: string | null;

  @ApiProperty({
    type: () => LocationOwnerDto,
    isArray: true,
    required: false,
    description: 'Rows from cw_location_owners linked by location_id.',
  })
  cw_location_owners?: LocationOwnerDto[];
}

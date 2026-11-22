import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';
import { LocationOwnerDto } from './location-owner.dto';

/**
 * The row as the API returns it: the group's name as `group` (see
 * groups/group-columns.ts), never the stored `group_id`.
 */
type LocationRow = Omit<
  Database['public']['Tables']['cw_locations']['Row'],
  'group_id'
>;

export class LocationDto implements LocationRow {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ nullable: true, required: false })
  description: string | null;

  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Name of the location group (cw_location_groups), or null.',
  })
  group: string | null;

  @ApiProperty({ nullable: true, required: false })
  lat: number | null;

  @ApiProperty()
  location_id: number;

  @ApiProperty({ nullable: true, required: false })
  long: number | null;

  @ApiProperty({ nullable: true, required: false })
  map_zoom: number | null;

  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Owning organization (025)',
  })
  org_id: string | null;

  @ApiProperty()
  name: string;

  @ApiProperty({
    enum: ['as1', 'au1', 'eu1', 'nam1'],
    description: 'TTI cluster new devices here are registered on (031)',
  })
  network_region: string;

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

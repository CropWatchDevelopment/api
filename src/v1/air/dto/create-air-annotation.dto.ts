import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type AirAnnotationInsert =
  Database['public']['Tables']['cw_air_annotations']['Insert'];

export class CreateAirAnnotationDto implements AirAnnotationInsert {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty()
  dev_eui: string;

  @ApiProperty({ required: false })
  id?: number;

  @ApiProperty({ nullable: true, required: false })
  note?: string | null;
}

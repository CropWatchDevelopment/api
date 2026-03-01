import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type AirAnnotation = Database['public']['Tables']['cw_air_annotations']['Row'];

export class AirAnnotationDto implements AirAnnotation {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty()
  dev_eui: string;

  @ApiProperty()
  id: number;

  @ApiProperty({ nullable: true, required: false })
  note: string | null;
}

import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type AirAnnotation = Database['public']['Tables']['cw_air_annotations']['Row'];

export class AirAnnotationDto implements AirAnnotation {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty()
  created_by: string;

  @ApiProperty()
  dev_eui: string;

  @ApiProperty()
  id: number;

  @ApiProperty()
  include_in_report: boolean;

  @ApiProperty({ nullable: true, required: false, type: String })
  note: string | null;

  @ApiProperty()
  title: string;
}

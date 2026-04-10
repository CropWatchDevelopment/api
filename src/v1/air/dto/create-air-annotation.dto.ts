import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { Database } from '../../../../database.types';

type AirAnnotationInsert = Omit<
  Database['public']['Tables']['cw_air_annotations']['Insert'],
  'created_by' | 'id'
>;

export class CreateAirAnnotationDto implements AirAnnotationInsert {
  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  created_at: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dev_eui: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiProperty({ type: String })
  @IsString()
  title: string;

  @ApiProperty({ type: Boolean })
  @IsBoolean()
  include_in_report: boolean;
}

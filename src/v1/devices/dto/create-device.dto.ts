import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Database } from '../../../../database.types';

type DeviceInsert = Database['public']['Tables']['cw_devices']['Insert'];

export class CreateDeviceDto implements DeviceInsert {
  @ApiProperty({ description: 'LoRaWAN dev_eui', example: 'A1B2C3D4E5F60708' })
  @IsString()
  @IsNotEmpty()
  dev_eui: string;

  @ApiProperty({
    required: false,
    description: 'Device display name',
    example: 'Greenhouse Sensor 1',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Device type id (cw_device_type.id)',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  type?: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Upload interval in minutes',
    example: 60,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  upload_interval?: number | null;

  @ApiProperty({ required: false, nullable: true, example: 35.6895 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  lat?: number | null;

  @ApiProperty({ required: false, nullable: true, example: 139.6917 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  long?: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Install date (YYYY-MM-DD)',
    example: '2026-03-16',
  })
  @IsOptional()
  @IsISO8601()
  installed_at?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Battery last changed date (YYYY-MM-DD)',
    example: '2026-03-16',
  })
  @IsOptional()
  @IsISO8601()
  battery_changed_at?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Owner user id (uuid)',
  })
  @IsOptional()
  @IsString()
  user_id?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Warranty start date (YYYY-MM-DD)',
    example: '2026-03-16',
  })
  @IsOptional()
  @IsISO8601()
  warranty_start_date?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  sensor1_serial?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  sensor2_serial?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  sensor_serial?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Location id (cw_locations.location_id)',
    example: 54,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  location_id?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  report_endpoint?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  battery_level?: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Last time device uplinked (ISO 8601)',
    format: 'date-time',
  })
  @IsOptional()
  @IsISO8601()
  last_data_updated_at?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  tti_name?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  primary_data?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  secondary_data?: number | null;

  @ApiProperty({ required: false, nullable: true, example: 'Greenhouse A' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  group?: string | null;
}

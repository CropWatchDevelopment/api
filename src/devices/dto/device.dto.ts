import { ApiProperty } from '@nestjs/swagger';

export class DeviceDto {
  @ApiProperty({ description: 'LoRaWAN dev_eui', example: 'A1B2C3D4E5F60708' })
  dev_eui: string;

  @ApiProperty({ description: 'Device display name', example: 'Greenhouse Sensor 1' })
  name: string;

  @ApiProperty({ required: false, nullable: true, description: 'Device type id (cw_device_type.id)' })
  type: number | null;

  @ApiProperty({ required: false, nullable: true, description: 'Upload interval in minutes' })
  upload_interval: number | null;

  @ApiProperty({ required: false, nullable: true })
  lat: number | null;

  @ApiProperty({ required: false, nullable: true })
  long: number | null;

  @ApiProperty({ required: false, nullable: true, description: 'Install date (YYYY-MM-DD)' })
  installed_at: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'Battery last changed date (YYYY-MM-DD)' })
  battery_changed_at: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'Owner user id (uuid)' })
  user_id: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'Warranty start date (YYYY-MM-DD)' })
  warranty_start_date: string | null;

  @ApiProperty({ required: false, nullable: true })
  sensor1_serial: string | null;

  @ApiProperty({ required: false, nullable: true })
  sensor2_serial: string | null;

  @ApiProperty({ required: false, nullable: true })
  sensor_serial: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'Location id (cw_locations.location_id)' })
  location_id: number | null;

  @ApiProperty({ required: false, nullable: true })
  report_endpoint: string | null;

  @ApiProperty({ required: false, nullable: true })
  battery_level: number | null;

  @ApiProperty({ required: false, nullable: true, description: 'Last time device uplinked (ISO 8601)' })
  last_data_updated_at: string | null;

  @ApiProperty({ required: false, nullable: true })
  tti_name: string | null;

  @ApiProperty({ required: false, nullable: true })
  primary_data: number | null;

  @ApiProperty({ required: false, nullable: true })
  secondary_data: number | null;

  @ApiProperty({ required: false, nullable: true })
  group: string | null;
}

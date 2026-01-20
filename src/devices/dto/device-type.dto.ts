import { ApiProperty } from '@nestjs/swagger';

export class DeviceTypeDto {
  @ApiProperty({ description: 'Device type id', example: 1 })
  id: number;

  @ApiProperty({
    description: 'Device type name',
    example: 'CropWatch Soil Sensor',
  })
  name: string;

  @ApiProperty({ required: false, nullable: true })
  model: string | null;

  @ApiProperty({ required: false, nullable: true })
  manufacturer: string | null;

  @ApiProperty({
    description: 'Whether the device type is active',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({ description: 'Data table v2 name', example: 'cw_soil_data' })
  data_table_v2: string;

  @ApiProperty({ description: 'Primary data key v2', example: 'moisture' })
  primary_data_v2: string;

  @ApiProperty({
    description: 'Secondary data key v2',
    example: 'temperature_c',
  })
  secondary_data_v2: string;

  @ApiProperty({ required: false, nullable: true })
  TTI_application_id: string | null;
}

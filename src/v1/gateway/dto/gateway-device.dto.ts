import { ApiProperty } from '@nestjs/swagger';

export class GatewayDeviceDto {
  @ApiProperty()
  dev_eui: string;

  @ApiProperty({ nullable: true, type: String })
  name: string | null;

  @ApiProperty({ nullable: true, type: Number })
  location_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  location_name: string | null;

  @ApiProperty({ nullable: true, type: Number })
  rssi: number | null;

  @ApiProperty({ nullable: true, type: Number })
  snr: number | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  last_update: string | null;
}

export class GatewayDevicesResponseDto {
  @ApiProperty({
    type: () => GatewayDeviceDto,
    isArray: true,
    description:
      'Devices heard within the connected window that the caller can read, newest first.',
  })
  devices: GatewayDeviceDto[];

  @ApiProperty({
    description:
      'Devices heard within the connected window that the caller cannot read.',
  })
  other_device_count: number;
}

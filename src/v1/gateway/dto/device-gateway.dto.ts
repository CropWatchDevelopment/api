import { ApiProperty } from '@nestjs/swagger';

export class DeviceGatewayDto {
  @ApiProperty({
    description:
      'True when the gateway is not visible to the caller (or not registered in CropWatch); identity fields are then null.',
  })
  anonymized: boolean;

  @ApiProperty({ nullable: true, type: String })
  gateway_id: string | null;

  @ApiProperty({ nullable: true, type: String })
  gateway_name: string | null;

  @ApiProperty({
    nullable: true,
    type: Boolean,
    description: 'Null when anonymized or the gateway is unknown.',
  })
  is_online: boolean | null;

  @ApiProperty({ nullable: true, type: Number })
  rssi: number | null;

  @ApiProperty({ nullable: true, type: Number })
  snr: number | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  last_update: string | null;
}

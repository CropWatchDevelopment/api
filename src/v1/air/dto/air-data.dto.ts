import { ApiProperty } from '@nestjs/swagger';

export class AirDataDto {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty()
  dev_eui: string;

  @ApiProperty({ nullable: true, required: false })
  battery_level: number | null;

  @ApiProperty({ nullable: true, required: false })
  co: number | null;

  @ApiProperty({ nullable: true, required: false })
  co2: number | null;

  @ApiProperty({ nullable: true, required: false })
  humidity: number | null;

  @ApiProperty({ required: false })
  is_simulated: boolean;

  @ApiProperty({ nullable: true, required: false })
  lux: number | null;

  @ApiProperty({ nullable: true, required: false })
  pressure: number | null;

  @ApiProperty({ nullable: true, required: false })
  rainfall: number | null;

  @ApiProperty({ nullable: true, required: false })
  smoke_detected: boolean | null;

  @ApiProperty({ nullable: true, required: false })
  temperature_c: number | null;

  @ApiProperty({ nullable: true, required: false })
  uv_index: number | null;

  @ApiProperty({ nullable: true, required: false })
  vape_detected: boolean | null;

  @ApiProperty({ nullable: true, required: false })
  wind_direction: number | null;

  @ApiProperty({ nullable: true, required: false })
  wind_speed: number | null;
}

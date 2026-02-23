import { ApiProperty } from '@nestjs/swagger';

export class WaterDataDto {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty()
  dev_eui: string;

  @ApiProperty()
  id: number;

  @ApiProperty({ nullable: true, required: false })
  deapth_cm: number | null;

  @ApiProperty({ nullable: true, required: false })
  pressure: number | null;

  @ApiProperty({ nullable: true, required: false })
  spo2: number | null;

  @ApiProperty({ nullable: true, required: false })
  temperature_c: number | null;
}

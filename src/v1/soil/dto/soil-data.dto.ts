import { ApiProperty } from '@nestjs/swagger';

export class SoilDataDto {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty()
  dev_eui: string;

  @ApiProperty({ nullable: true, required: false })
  ec: number | null;

  @ApiProperty({ nullable: true, required: false })
  moisture: number | null;

  @ApiProperty({ nullable: true, required: false })
  ph: number | null;

  @ApiProperty({ nullable: true, required: false })
  temperature_c: number | null;
}

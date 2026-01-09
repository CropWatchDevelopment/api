import { ApiProperty } from '@nestjs/swagger';

export class TrafficDataDto {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty()
  dev_eui: string;

  @ApiProperty()
  id: number;

  @ApiProperty()
  bicycle_count: number;

  @ApiProperty()
  bus_count: number;

  @ApiProperty()
  car_count: number;

  @ApiProperty({ nullable: true, required: false })
  line_number: number | null;

  @ApiProperty()
  people_count: number;

  @ApiProperty({ nullable: true, required: false })
  traffic_hour: string | null;

  @ApiProperty()
  truck_count: number;
}

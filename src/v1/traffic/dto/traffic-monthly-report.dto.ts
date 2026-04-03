import { ApiProperty } from '@nestjs/swagger';

export class TrafficMonthlyReportDto {
  @ApiProperty({ description: 'Date of the traffic day', example: '2026-03-01' })
  traffic_day: string;

  @ApiProperty({ description: 'Total people count for the day', example: 1530 })
  total_people: number;

  @ApiProperty({ description: 'Total bicycle count for the day', example: 590 })
  total_bicycles: number;

  @ApiProperty({ description: 'Total vehicle count (cars + trucks + buses) for the day', example: 3252 })
  total_vehicles: number;
}

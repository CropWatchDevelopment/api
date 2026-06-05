import { ApiProperty } from '@nestjs/swagger';

export class ReportTemplateDataProcessingScheduleDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  templateId: number;

  @ApiProperty({ description: 'Day of week, 0 (Sunday) – 6 (Saturday).' })
  dayOfWeek: number;

  @ApiProperty({ description: 'HH:MM(:SS) local time.' })
  startTime: string;

  @ApiProperty({ description: 'HH:MM(:SS) local time.' })
  endTime: string;

  @ApiProperty()
  crossesMidnight: boolean;

  @ApiProperty({ description: "'include' or 'exclude'." })
  ruleType: string;

  @ApiProperty({ nullable: true, required: false, format: 'date' })
  validFrom: string | null;

  @ApiProperty({ nullable: true, required: false, format: 'date' })
  validTo: string | null;

  @ApiProperty()
  timezone: string;

  @ApiProperty()
  isEnabled: boolean;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  createdAt: string | null;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  updatedAt: string | null;
}

import { ApiProperty } from '@nestjs/swagger';

export class ReportTemplateScheduleDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  templateId: number;

  @ApiProperty()
  endOfDay: boolean;

  @ApiProperty()
  endOfWeek: boolean;

  @ApiProperty()
  endOfMonth: boolean;

  @ApiProperty()
  utcOffset: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  createdAt: string | null;
}

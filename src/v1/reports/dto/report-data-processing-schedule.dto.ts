import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type ReportDataProcessingScheduleRow =
  Database['public']['Tables']['report_data_processing_schedules']['Row'];

export class ReportDataProcessingScheduleDto implements ReportDataProcessingScheduleRow {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty()
  crosses_midnight: boolean;

  @ApiProperty()
  day_of_week: number;

  @ApiProperty()
  end_time: string;

  @ApiProperty()
  id: string;

  @ApiProperty()
  is_enabled: boolean;

  @ApiProperty()
  report_id: string;

  @ApiProperty()
  rule_type: string;

  @ApiProperty()
  start_time: string;

  @ApiProperty()
  timezone: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty({ nullable: true, required: false })
  valid_from: string | null;

  @ApiProperty({ nullable: true, required: false })
  valid_to: string | null;
}

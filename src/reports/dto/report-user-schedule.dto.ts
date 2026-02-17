import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../database.types';

type ReportUserScheduleRow =
  Database['public']['Tables']['report_user_schedule']['Row'];

export class ReportUserScheduleDto implements ReportUserScheduleRow {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty()
  dev_eui: string;

  @ApiProperty()
  end_of_month: boolean;

  @ApiProperty()
  end_of_week: boolean;

  @ApiProperty()
  id: number;

  @ApiProperty()
  is_active: boolean;

  @ApiProperty({ nullable: true, required: false })
  report_id: string | null;

  @ApiProperty()
  report_user_schedule_id: number;

  @ApiProperty()
  user_id: string;
}

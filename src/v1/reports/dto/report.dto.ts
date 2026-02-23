import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';
import { ReportAlertPointDto } from './report-alert-point.dto';
import { ReportRecipientDto } from './report-recipient.dto';
import { ReportUserScheduleDto } from './report-user-schedule.dto';

type ReportRow = Database['public']['Tables']['reports']['Row'];

export class ReportDto implements ReportRow {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty()
  dev_eui: string;

  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  report_id: string;

  @ApiProperty({ nullable: true, required: false })
  user_id: string | null;

  @ApiProperty({
    type: () => ReportUserScheduleDto,
    isArray: true,
    required: false,
    description: 'Rows from report_user_schedule linked to this report.',
  })
  report_user_schedule?: ReportUserScheduleDto[];

  @ApiProperty({
    type: () => ReportAlertPointDto,
    isArray: true,
    required: false,
    description: 'Rows from report_alert_points linked to this report.',
  })
  report_alert_points?: ReportAlertPointDto[];

  @ApiProperty({
    type: () => ReportRecipientDto,
    isArray: true,
    required: false,
    description: 'Rows from report_recipients linked to this report.',
  })
  report_recipients?: ReportRecipientDto[];
}

import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../database.types';

type ReportAlertPointRow =
  Database['public']['Tables']['report_alert_points']['Row'];

export class ReportAlertPointDto implements ReportAlertPointRow {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty()
  data_point_key: string;

  @ApiProperty({ nullable: true, required: false })
  hex_color: string | null;

  @ApiProperty()
  id: number;

  @ApiProperty({ nullable: true, required: false })
  max: number | null;

  @ApiProperty({ nullable: true, required: false })
  min: number | null;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, required: false })
  operator: string | null;

  @ApiProperty()
  report_id: string;

  @ApiProperty()
  user_id: string;

  @ApiProperty({ nullable: true, required: false })
  value: number | null;
}

import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../database.types';
import { CreateReportAlertPointDto } from './create-report-alert-point.dto';
import { CreateReportRecipientDto } from './create-report-recipient.dto';
import { CreateReportUserScheduleDto } from './create-report-user-schedule.dto';

type ReportInsert = Database['public']['Tables']['reports']['Insert'];

export class CreateReportDto implements ReportInsert {
	@ApiProperty({ required: false, format: 'date-time' })
	created_at?: string;

	@ApiProperty()
	dev_eui: string;

	@ApiProperty({ required: false })
	id?: number;

	@ApiProperty()
	name: string;

	@ApiProperty({ required: false })
	report_id?: string;

	@ApiProperty({ required: false, nullable: true })
	user_id?: string | null;

	@ApiProperty({
		type: () => CreateReportUserScheduleDto,
		isArray: true,
		required: false,
		description: 'Rows from report_user_schedule linked to this report.',
	})
	report_user_schedule?: CreateReportUserScheduleDto[];

	@ApiProperty({
		type: () => CreateReportAlertPointDto,
		isArray: true,
		required: false,
		description: 'Rows from report_alert_points linked to this report.',
	})
	report_alert_points?: CreateReportAlertPointDto[];

	@ApiProperty({
		type: () => CreateReportRecipientDto,
		isArray: true,
		required: false,
		description: 'Rows from report_recipients linked to this report.',
	})
	report_recipients?: CreateReportRecipientDto[];
}

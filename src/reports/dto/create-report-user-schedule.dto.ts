import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../database.types';

type ReportUserScheduleInsert =
	Database['public']['Tables']['report_user_schedule']['Insert'];

export class CreateReportUserScheduleDto implements ReportUserScheduleInsert {
	@ApiProperty({ required: false, format: 'date-time' })
	created_at?: string;

	@ApiProperty()
	dev_eui: string;

	@ApiProperty({ required: false })
	end_of_month?: boolean;

	@ApiProperty({ required: false })
	end_of_week?: boolean;

	@ApiProperty({ required: false })
	id?: number;

	@ApiProperty({ required: false })
	is_active?: boolean;

	@ApiProperty({ required: false, nullable: true })
	report_id?: string | null;

	@ApiProperty({ required: false })
	report_user_schedule_id?: number;

	@ApiProperty({ required: false })
	user_id?: string;
}

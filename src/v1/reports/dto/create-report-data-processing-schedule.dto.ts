import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type ReportDataProcessingScheduleInsert =
	Database['public']['Tables']['report_data_processing_schedules']['Insert'];

export class CreateReportDataProcessingScheduleDto implements ReportDataProcessingScheduleInsert {
	@ApiProperty({ required: false, format: 'date-time' })
	created_at?: string;

	@ApiProperty({ required: false })
	crosses_midnight?: boolean;

	@ApiProperty()
	day_of_week: number;

	@ApiProperty()
	end_time: string;

	@ApiProperty({ required: false })
	id?: string;

	@ApiProperty({ required: false })
	is_enabled?: boolean;

	@ApiProperty()
	report_id: string;

	@ApiProperty({ required: false })
	rule_type?: string;

	@ApiProperty()
	start_time: string;

	@ApiProperty({ required: false })
	timezone?: string;

	@ApiProperty({ required: false, format: 'date-time' })
	updated_at?: string;

	@ApiProperty({ required: false, nullable: true })
	valid_from?: string | null;

	@ApiProperty({ required: false, nullable: true })
	valid_to?: string | null;
}

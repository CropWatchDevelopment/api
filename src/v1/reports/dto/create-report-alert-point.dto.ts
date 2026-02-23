import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type ReportAlertPointInsert =
	Database['public']['Tables']['report_alert_points']['Insert'];

export class CreateReportAlertPointDto implements ReportAlertPointInsert {
	@ApiProperty({ required: false, format: 'date-time' })
	created_at?: string;

	@ApiProperty()
	data_point_key: string;

	@ApiProperty({ required: false, nullable: true })
	hex_color?: string | null;

	@ApiProperty({ required: false })
	id?: number;

	@ApiProperty({ required: false, nullable: true })
	max?: number | null;

	@ApiProperty({ required: false, nullable: true })
	min?: number | null;

	@ApiProperty()
	name: string;

	@ApiProperty({ required: false, nullable: true })
	operator?: string | null;

	@ApiProperty()
	report_id: string;

	@ApiProperty({ required: false })
	user_id?: string;

	@ApiProperty({ required: false, nullable: true })
	value?: number | null;
}

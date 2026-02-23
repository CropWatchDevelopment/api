import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type ReportRecipientInsert =
	Database['public']['Tables']['report_recipients']['Insert'];

export class CreateReportRecipientDto implements ReportRecipientInsert {
	@ApiProperty()
	communication_method: number;

	@ApiProperty({ required: false, format: 'date-time' })
	created_at?: string;

	@ApiProperty({ required: false, nullable: true })
	email?: string | null;

	@ApiProperty({ required: false })
	id?: number;

	@ApiProperty({ required: false, nullable: true })
	name?: string | null;

	@ApiProperty()
	report_id: string;

	@ApiProperty({ required: false, nullable: true })
	user_id?: string | null;
}

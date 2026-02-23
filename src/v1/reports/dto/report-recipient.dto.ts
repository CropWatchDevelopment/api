import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';

type ReportRecipientRow =
	Database['public']['Tables']['report_recipients']['Row'];

export class ReportRecipientDto implements ReportRecipientRow {
	@ApiProperty()
	communication_method: number;

	@ApiProperty({ format: 'date-time' })
	created_at: string;

	@ApiProperty({ nullable: true, required: false })
	email: string | null;

	@ApiProperty()
	id: number;

	@ApiProperty({ nullable: true, required: false })
	name: string | null;

	@ApiProperty()
	report_id: string;

	@ApiProperty({ nullable: true, required: false })
	user_id: string | null;
}

import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Database } from '../../../../database.types';
import { CreateReportAlertPointDto } from './create-report-alert-point.dto';
import { CreateReportDataProcessingScheduleDto } from './create-report-data-processing-schedule.dto';
import { CreateReportRecipientDto } from './create-report-recipient.dto';
import { CreateReportUserScheduleDto } from './create-report-user-schedule.dto';

type ReportInsert = Database['public']['Tables']['reports']['Insert'];

export class CreateReportDto implements ReportInsert {
	@ApiProperty({ required: false, format: 'date-time' })
	@IsOptional()
	@IsISO8601()
	created_at?: string;

	@ApiProperty({ required: false, minimum: 1 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	data_pull_interval?: number;

	@ApiProperty()
	@IsString()
	@IsNotEmpty()
	dev_eui: string;

	@ApiProperty({ required: false })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	id?: number;

	@ApiProperty()
	@IsString()
	@IsNotEmpty()
	name: string;

	@ApiProperty({ required: false })
	@IsOptional()
	@IsString()
	report_id?: string;

	@ApiProperty({ required: false, nullable: true })
	@IsOptional()
	@IsString()
	user_id?: string | null;

	@ApiProperty({
		type: () => CreateReportUserScheduleDto,
		isArray: true,
		required: false,
		description: 'Rows from report_user_schedule linked to this report.',
	})
	@IsOptional()
	@IsArray()
	report_user_schedule?: CreateReportUserScheduleDto[];

	@ApiProperty({
		type: () => CreateReportAlertPointDto,
		isArray: true,
		required: false,
		description: 'Rows from report_alert_points linked to this report.',
	})
	@IsOptional()
	@IsArray()
	report_alert_points?: CreateReportAlertPointDto[];

	@ApiProperty({
		type: () => CreateReportRecipientDto,
		isArray: true,
		required: false,
		description: 'Rows from report_recipients linked to this report.',
	})
	@IsOptional()
	@IsArray()
	report_recipients?: CreateReportRecipientDto[];

	@ApiProperty({
		type: () => CreateReportDataProcessingScheduleDto,
		isArray: true,
		required: false,
		description: 'Rows from report_data_processing_schedules linked to this report.',
	})
	@IsOptional()
	@IsArray()
	report_data_processing_schedules?: CreateReportDataProcessingScheduleDto[];
}

import { ApiProperty } from '@nestjs/swagger';
import { ReportTemplateAlertPointDto } from './report-template-alert-point.dto';
import { ReportTemplateAssignmentDto } from './report-template-assignment.dto';
import { ReportTemplateDataProcessingScheduleDto } from './report-template-data-processing-schedule.dto';
import { ReportTemplateRecipientDto } from './report-template-recipient.dto';
import { ReportTemplateScheduleDto } from './report-template-schedule.dto';

export class ReportTemplateDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, required: false })
  description: string | null;

  @ApiProperty({ nullable: true, required: false })
  deviceTypeId: number | null;

  @ApiProperty({ description: 'Sampling interval in minutes used when building the report.' })
  dataPullInterval: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  createdAt: string | null;

  @ApiProperty({ type: () => ReportTemplateAssignmentDto, isArray: true })
  assignments: ReportTemplateAssignmentDto[];

  @ApiProperty({ type: () => ReportTemplateScheduleDto, isArray: true })
  schedule: ReportTemplateScheduleDto[];

  @ApiProperty({ type: () => ReportTemplateRecipientDto, isArray: true })
  recipients: ReportTemplateRecipientDto[];

  @ApiProperty({ type: () => ReportTemplateAlertPointDto, isArray: true })
  alertPoints: ReportTemplateAlertPointDto[];

  @ApiProperty({ type: () => ReportTemplateDataProcessingScheduleDto, isArray: true })
  dataProcessingSchedules: ReportTemplateDataProcessingScheduleDto[];
}

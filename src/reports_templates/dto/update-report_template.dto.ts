import { PartialType } from '@nestjs/swagger';
import { CreateReportTemplateDto } from './create-report_template.dto';

export class UpdateReportDto extends PartialType(CreateReportTemplateDto) {}

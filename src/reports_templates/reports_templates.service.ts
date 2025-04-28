import { Injectable } from '@nestjs/common';
import { BaseService } from '../bases/base.service';
import { UpdateReportDto } from './dto/update-report_template.dto';
import { ReportTemplatesRepository } from '../repositories/reports_templates.repository';
import { CreateReportTemplateDto } from './dto/create-report_template.dto';
import { ReportsTemplatesRow } from '../common/database-types';

@Injectable()
export class ReportsTemplatesService extends BaseService<ReportsTemplatesRow, CreateReportTemplateDto, UpdateReportDto> {
    constructor(private readonly reportTemplatesRepository: ReportTemplatesRepository) {
        super(reportTemplatesRepository);
    }

    getReportTemplateByDevEui(devEui: string): Promise<ReportsTemplatesRow> {
        return this.reportTemplatesRepository.findByDevEui({ dev_eui: devEui });
    }
}

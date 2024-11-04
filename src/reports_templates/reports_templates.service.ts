import { Injectable } from '@nestjs/common';
import { Database } from 'database.types';
import { BaseService } from 'src/bases/base.service';
import { UpdateReportDto } from './dto/update-report_template.dto';
import { ReportTemplatesRepository } from 'src/repositories/reports_templates.repository';
import { CreateReportTemplateDto } from './dto/create-report_template.dto';

type ReportsTemplatesRow = Database['public']['Tables']['reports_templates']['Row'];

@Injectable()
export class ReportsTemplatesService extends BaseService<ReportsTemplatesRow, CreateReportTemplateDto, UpdateReportDto> {
    constructor(private readonly reportTemplatesRepository: ReportTemplatesRepository) {
        super(reportTemplatesRepository);
    }

    getReportTemplateByDevEui(devEui: string): Promise<ReportsTemplatesRow> {
        return this.reportTemplatesRepository.findByDevEui({ dev_eui: devEui });
    }
}

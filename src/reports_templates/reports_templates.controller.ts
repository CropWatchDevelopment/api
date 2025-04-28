import { Controller, Get } from '@nestjs/common';
import { ReportsTemplatesService } from './reports_templates.service';

@Controller('reports-templates')
export class ReportsTemplatesController {
    constructor(private readonly reportTemplatesService: ReportsTemplatesService) {

    }

    @Get()
    GetReportTemplates() {
        return this.reportTemplatesService.findAll();
  }
}

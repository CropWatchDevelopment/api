import { Injectable } from '@nestjs/common';
import { DataService, FindAllParams } from 'src/data/data.service';
import { ReportsTemplatesService } from 'src/reports_templates/reports_templates.service';

// PDF Import stuff
import { mapToPdfReport } from './data-formatters/legacy-test';
import { CwDevicesService } from 'src/cw_devices/cw_devices.service';
import { pdfReportFormat } from './interfaces/report.interface';
import { buildColdChainReport } from './PdfTemplateTypes/ColdChain';
import { buildCO2Report } from './PdfTemplateTypes/Co2Report';


@Injectable()
export class PdfService {
  constructor(
    private readonly dataService: DataService,
    private readonly reportsTemplatesService: ReportsTemplatesService,
    private readonly deviceService: CwDevicesService,
  ) { }

  public async createPdfBinary(user_id: string, devEui: string, start: Date, end: Date): Promise<Buffer> {
    if (!user_id) throw new Error('User ID is required');
    if (!devEui) throw new Error('DevEui is required');
    let rawData = await this.fetchDataAndReportFromDB(devEui, user_id, start, end);
    let device = await this.deviceService.getDeviceByDevEui(devEui);
    const pdfReport = await mapToPdfReport(
      rawData,
      'Acme Corp',             // company
      'Engineering',           // department
      'Warehouse 7',           // usage location
      device.name,         // sensor name
      devEui             // devEui
    );

    if (device.report_endpoint.includes('cold-storage')) {
      return await buildColdChainReport(pdfReport);
    } else if (device.report_endpoint.includes('co2-report')) {
      return await buildCO2Report(rawData);
    } else {
      throw new Error('Report endpoint not found');
    }
  }




  private async fetchDataAndReportFromDB(devEui: string, user_id: string, start: Date, end: Date) {
    // Example: fetch 10 items
    const findAllParams: FindAllParams = {
      devEui,
      skip: 0,
      take: 10,
      order: 'ASC',
      start,
      end,
    };
    const reportData = await this.dataService.findAllBetweenDateTimeRange(
      findAllParams,
      user_id
    );
    return reportData;
  }
}

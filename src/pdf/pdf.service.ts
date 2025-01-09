import { Injectable } from '@nestjs/common';
import { DataService } from 'src/data/data.service';
import { ReportsTemplatesService } from 'src/reports_templates/reports_templates.service';

// PDF Import stuff
import PDFDocument from 'pdfkit';
import { pdfReportFormat } from './interfaces/report.interface';
import { mapToPdfReport } from './data-formatters/legacy-test';
import { drawHeaderAndSignatureBoxes } from './pdf-parts/drawHeaderAndSignatureBoxes';
import { drawSimpleLineChartD3Style } from './pdf-parts/drawBetterChartWithD3';
import { drawDataTable12Cols } from './pdf-parts/drawMultiColumnTable';
import { TableColorRange } from './interfaces/TableColorRange';


@Injectable()
export class PdfService {
  constructor(
    private readonly dataService: DataService,
    private readonly reportsTemplatesService: ReportsTemplatesService
  ) { }

  public async createPdfBinary(user_id: string, devEui: string) {
    if (!user_id) throw new Error('User ID is required');
    if (!devEui) throw new Error('DevEui is required');
    let rawData = await this.fetchDataAndReportFromDB(devEui, user_id);
    const pdfReport = mapToPdfReport(
      rawData,
      'Acme Corp',             // company
      'Engineering',           // department
      'Warehouse 7',           // usage location
      'Thermometer A1'         // sensor name
    );

    console.log(pdfReport);
    const fileBuffer = await this.buildPdfReport(pdfReport);
    return fileBuffer;
  }

  async buildPdfReport(reportData: pdfReportFormat): Promise<Buffer> {
    return new Promise<Buffer>(async (resolve, reject) => {
      try {
        // Create a new PDF document
        const doc = new PDFDocument({
          size: 'A4', // 595.28 x 841.89 (approx)
          margin: 40
        });

        doc.registerFont('NotoSansJP', 'src/assets/fonts/Noto_Sans_JP/static/NotoSansJP-Regular.ttf');
        doc.font('NotoSansJP');

        // Collect chunks in memory
        const buffers: Buffer[] = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => {
          const pdfData = Buffer.concat(buffers);
          resolve(pdfData);
        });

        // Build content (this is where you'd call your helper functions)
        drawHeaderAndSignatureBoxes(doc, reportData);
        // drawGraph(doc, reportData.dataPoints);

        doc.x = doc.page.margins.left;
        await drawSimpleLineChartD3Style(
          doc,
          reportData.dataPoints
        );

        const tableColorRange: TableColorRange[] = [
          {
            name: 'alert',
            min: 0,
            max: 9999,
            color: 'red'
          },
          {
            name: 'warning',
            min: -15.1,
            max: 0,
            color: 'orange'
          },
          {
            name: 'notice',
            min: -15.1,
            max: -17.99,
            color: 'yellow'
          },
          {
            name: 'normal',
            min: -18,
            max: -1000,
            color: 'white'
          }
        ];
        doc.x = doc.page.margins.left;
        drawDataTable12Cols(doc, reportData.dataPoints.map((d) => ({ createdAt: new Date(d.date).toDateString(), temperature: d.value })), tableColorRange);

        // Finalize the PDF (triggers the 'end' event)
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }


  private async fetchDataAndReportFromDB(devEui: string, user_id: string) {
    // Example: fetch 10 items
    const reportData = await this.dataService.findAll(
      { devEui, skip: 0, take: 1000, order: 'ASC' },
      user_id
    );
    const reportJsonResponse = await this.reportsTemplatesService.getReportTemplateByDevEui(
      devEui
    );
    const reportString = JSON.stringify(reportJsonResponse.template);
    return { reportString, reportData };
  }
}

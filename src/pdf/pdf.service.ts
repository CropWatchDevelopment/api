import { Injectable } from '@nestjs/common';
import { join } from 'path';
import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions, TFontDictionary } from 'pdfmake/build/pdfmake';
import { DataService } from 'src/data/data.service';
import { ReportsTemplatesService } from 'src/reports_templates/reports_templates.service';
import { getFontPaths } from 'src/utils/font-loader';


@Injectable()
export class PdfService {
    constructor(
        private readonly dataService: DataService,
        private readonly reportsTemplatesService: ReportsTemplatesService
    ) { }

    private fonts: TFontDictionary = {
        Roboto: getFontPaths('Roboto', 'src/assets/fonts/Roboto'),
        Noto_Sans_JP: getFontPaths('NotoSansJP', 'src/assets/fonts/Noto_Sans_JP/static'),
    };

    public async createPdfBinary(user_id: string, devEui: string): Promise<Buffer> {
        if (!user_id) {
            throw new Error('User ID is required');
        }
        if (!devEui) {
            throw new Error('DevEui is required');
        }

        const { reportString, reportData } = await this.fetchDataAndReportFromDB(devEui, user_id);
        const reportJson = this.insertDataIntoReport(reportString, reportData);

        const printer: PdfPrinter = new PdfPrinter(this.fonts);
        const docDefinition: TDocumentDefinitions = reportJson; // `report` is already an object

        if (!docDefinition.content || !Array.isArray(docDefinition.content)) {
            throw new Error('Invalid report structure');
        }

        return new Promise((resolve, reject) => {
            const pdfDoc = printer.createPdfKitDocument(docDefinition);
            const chunks: Buffer[] = [];

            pdfDoc.on('data', (chunk) => chunks.push(chunk));
            pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
            pdfDoc.on('error', reject);

            pdfDoc.end();
        });
    }

    private async fetchDataAndReportFromDB(devEui: string, user_id: string) {
        // Fetch data from correct type (no clue how to map it later though....)
        const reportData: any[] = await this.dataService.findAll({
            devEui,
            skip: 0,
            take: 10,
            order: 'ASC',
        }, user_id);


        let reportJsonResponse = await this.reportsTemplatesService.getReportTemplateByDevEui(devEui);
        let reportString = JSON.stringify(reportJsonResponse.template);
        return { reportString, reportData };
    }

    private insertDataIntoReport(reportJson: string, data: any[]) {

        // Prepare data rows for the table
        const dataRows = data.map(item => [
            item.id,
            item.created_at,
            item.dewPointC,
            item.humidity,
            item.temperatureC,
            item.vpd,
            item.dev_eui,
            item.profile_id
        ]);

        // Parse JSON and directly insert `dataRows` as an array
        reportJson = reportJson.replace(/{{dev_eui}}/g, data[0]?.dev_eui || '');
        const report = JSON.parse(reportJson); // Parse to an object only once
        report.content[2].table.body = [
            report.content[2].table.body[0], // Header row
            ...dataRows                      // Data rows
        ];

        return report;
    }
}
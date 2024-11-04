import { Injectable } from '@nestjs/common';
import { join } from 'path';
import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions, TFontDictionary } from 'pdfmake/build/pdfmake';
import { DataService } from 'src/data/data.service';
import { ReportsTemplatesService } from 'src/reports_templates/reports_templates.service';


@Injectable()
export class PdfService {
    constructor(
        private readonly dataService: DataService,
        private readonly reportsTemplatesService: ReportsTemplatesService
    ) { }

    private fonts: TFontDictionary = {
        Roboto: {
            normal: join(process.cwd(), 'dist', '', 'src/assets/fonts/Roboto/Roboto-Regular.ttf'),
            bold: join(process.cwd(), 'dist', '', 'src/assets/fonts/Roboto/Roboto-Medium.ttf'),
            italics: join(process.cwd(), 'dist', '', 'src/assets/fonts/Roboto/Roboto-Italic.ttf'),
            bolditalics: join(process.cwd(), 'dist', '', 'src/assets/fonts/Roboto/Roboto-MediumItalic.ttf'),
        },
        Noto_Sans_JP: {
            normal: join(process.cwd(), 'dist', '', 'src/assets/fonts/Noto_Sans_JP/static/NotoSansJP-Regular.ttf'),
            bold: join(process.cwd(), 'dist', '', 'src/assets/fonts/Noto_Sans_JP/static/NotoSansJP-Medium.ttf'),
            italics: join(process.cwd(), 'dist', '', 'src/assets/fonts/Noto_Sans_JP/static/NotoSansJP-Light.ttf'),
            bolditalics: join(process.cwd(), 'dist', '', 'src/assets/fonts/Noto_Sans_JP/static/NotoSansJP-Light.ttf'),
        },
    };

    public async createPdfBinary(user_id: string, devEui: string): Promise<Buffer> {
        if (!user_id) {
            throw new Error('User ID is required');
        }
        if (!devEui) {
            throw new Error('DevEui is required');
        }
        
        // Fetch data from correct type (no clue how to map it later though....)
        const data: any[] = await this.dataService.findAll({
            devEui,
            skip: 0,
            take: 10,
            order: 'ASC',
        }, user_id);
    

        let reportJsonResponse = await this.reportsTemplatesService.getReportTemplateByDevEui(devEui);
        let reportJson = JSON.stringify(reportJsonResponse.template);
    
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
    
        // Replace `{{dev_eui}}` placeholder with actual `dev_eui` value
        reportJson = reportJson.replace(/{{dev_eui}}/g, data[0]?.dev_eui || '');
    
        // Parse JSON and directly insert `dataRows` as an array
        const report = JSON.parse(reportJson); // Parse to an object only once
        report.content[2].table.body = [
            report.content[2].table.body[0], // Header row
            ...dataRows                      // Data rows
        ];
    
        const printer: PdfPrinter = new PdfPrinter(this.fonts);
        const docDefinition: TDocumentDefinitions = report; // `report` is already an object
    
        return new Promise((resolve, reject) => {
            const pdfDoc = printer.createPdfKitDocument(docDefinition);
            const chunks: Buffer[] = [];
    
            pdfDoc.on('data', (chunk) => chunks.push(chunk));
            pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
            pdfDoc.on('error', reject);
    
            pdfDoc.end();
        });
    }
}
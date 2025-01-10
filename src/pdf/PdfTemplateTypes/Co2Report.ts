import PDFDocument from 'pdfkit';
import { pdfReportFormat } from "../interfaces/report.interface";
import { drawDynamicTable, TableColumn } from '../pdf-parts/drawDynamicTable';

// PARTS:


export async function buildCO2Report(reportData): Promise<Buffer> {
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

            let header: TableColumn[] = [];
            Object.keys(reportData[0]).forEach((key) => {
                if (key === 'co2_level' || key === 'created_at' || key === 'temperatureC' || key === 'humidity') {
                    
                    header.push({
                        header: key,
                        field: key,
                        width: 50
                    });
                }
            });
            drawDynamicTable(doc, header, reportData);

            // Finalize the PDF (triggers the 'end' event)
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}
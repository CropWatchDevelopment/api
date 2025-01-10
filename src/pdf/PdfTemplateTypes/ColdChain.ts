import PDFDocument from 'pdfkit';
import { pdfReportFormat } from "../interfaces/report.interface";

// PARTS:
import { drawHeaderAndSignatureBoxes } from '../pdf-parts/drawHeaderAndSignatureBoxes';
import { drawSimpleLineChartD3Style } from '../pdf-parts/drawBetterChartWithD3';
import { TableColorRange } from '../interfaces/TableColorRange';
import { drawDataTable12Cols } from '../pdf-parts/drawMultiColumnTable';

export async function buildColdChainReport(reportData: pdfReportFormat): Promise<Buffer> {
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

        // Draw the line chart
        doc.x = doc.page.margins.left;
        doc.fontSize(14).text('温度', doc.page.width / 2, doc.y, { width: 100 });
        await drawSimpleLineChartD3Style(
          doc,
          reportData.dataPoints
        );



        // Draw Table and all stuff related to it
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
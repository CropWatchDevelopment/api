import PDFDocument from 'pdfkit';

// PARTS:
import { drawHeaderAndSignatureBoxes } from '../pdf-parts/drawHeaderAndSignatureBoxes';
import { drawSimpleLineChartD3Style } from '../pdf-parts/drawBetterChartWithD3';
import { TableColorRange } from '../interfaces/TableColorRange';
import { drawDataTable12Cols } from '../pdf-parts/drawMultiColumnTable';
import moment from 'moment';

/**
 * buildColdChainReport
 * 
 *  - Visually the same as your original ColdChain code
 *  - Returns a Promise<Buffer> like the CO2 report
 *  - Uses the same doc.on('data') / doc.on('end') pattern
 *  - Gracefully handles "no data" by generating a minimal PDF
 *
 * @param reportData A pdfReportFormat object with .dataPoints, etc.
 * @returns Promise<Buffer>
 */
export async function buildColdChainReport(reportData: any[], tableColorRange: TableColorRange[], reportUserData): Promise<Buffer> {
  return new Promise<Buffer>(async (resolve, reject) => {
    try {
      // -------------------------------------------------------------
      // 1) Create a new PDF document
      // -------------------------------------------------------------
      const doc = new PDFDocument({
        size: 'A4', // 595.28 x 841.89 (approx)
        margin: 40
      });

      // Register fonts if needed
      doc.registerFont('NotoSansJP', 'src/assets/fonts/Noto_Sans_JP/static/NotoSansJP-Regular.ttf');
      doc.font('NotoSansJP');

      // Collect chunks in memory
      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // -------------------------------------------------------------
      // 2) If there's no data, produce a minimal PDF and return
      // -------------------------------------------------------------
      if (!reportData) {
        doc.fontSize(14).text('No data available', {
          width: doc.page.width,
          align: 'center'
        });
        doc.end();
        return;
      }

      // -------------------------------------------------------------
      // 3) Draw Header & Signature Boxes (same as original)
      // -------------------------------------------------------------
      drawHeaderAndSignatureBoxes(doc, reportData, tableColorRange, reportUserData);

      // -------------------------------------------------------------
      // 4) Draw the line chart (same as original)
      // -------------------------------------------------------------
      doc.x = doc.page.margins.left;
      doc.fontSize(14).text('温度', doc.page.width / 2, doc.y, { width: 100 });
      await drawSimpleLineChartD3Style(
        doc,
        reportData
      );

      doc.x = doc.page.margins.left;
      drawDataTable12Cols(
        doc,
        reportData.map((d) => ({
          createdAt: moment(d.created_at).format('YYYY/MM/DD HH:mm:ss').toString(),
          temperature: d.temperature_c,
        })),
        tableColorRange,
        {
          rowHeight: 22,
        }
      );

      // -------------------------------------------------------------
      // 6) Finalize the PDF (triggers the 'end' event)
      // -------------------------------------------------------------
      doc.end();

    } catch (error) {
      reject(error);
    }
  });
}

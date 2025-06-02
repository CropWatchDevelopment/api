import PDFDocument from 'pdfkit';
import path from 'path';

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
export async function buildColdChainReport(
  reportData: any[],
  tableColorRange: TableColorRange[],
  reportUserData: any
): Promise<Buffer> {
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
      const fontPath = path.join(__dirname, '../../../assets/fonts/Noto_Sans_JP/static/NotoSansJP-Regular.ttf');
      doc.registerFont('NotoSansJP', fontPath);
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
      // 3) Destructure user data and define footer drawing function
      // -------------------------------------------------------------
      const { company, department, location, deviceName, dev_eui, timeSpan } = reportUserData;

      // Keep track of the current page number (first page is 1)
      let pageNumber = 1;

      // Helper function to draw the footer (using the location and page number)
      const drawFooter = (doc: PDFKit.PDFDocument, location: string, pageNumber: number) => {
        // Position the footer above the bottom margin
        const footerY = doc.page.height - doc.page.margins.bottom - 19;
        doc.fontSize(10)
          .fillColor('grey')
          .text(`${location} - Page ${pageNumber}`, doc.page.margins.left, footerY, {
            width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
            align: 'right'
          });
      };

      // Register footer on every new page
      doc.on('pageAdded', () => {
        pageNumber++;
        drawFooter(doc, location, pageNumber);
      });

      // -------------------------------------------------------------
      // 4) Draw Header & Signature Boxes (same as original)
      // -------------------------------------------------------------
      drawHeaderAndSignatureBoxes(doc, reportData, tableColorRange, reportUserData);

      // -------------------------------------------------------------
      // 5) Draw the line chart (same as original)
      // -------------------------------------------------------------
      doc.x = doc.page.margins.left;
      doc.fontSize(14).text('温度', doc.page.width / 2, doc.y, { width: 100 });
      await drawSimpleLineChartD3Style(doc, reportData);

      // -------------------------------------------------------------
      // 6) Draw the data table (same as original)
      // -------------------------------------------------------------
      doc.x = doc.page.margins.left;
      drawDataTable12Cols(
        doc,
        reportData.map((d) => ({
          createdAt: moment(d.created_at).format('YYYY/MM/DD HH:mm:ss').toString(),
          temperature: d.temperature_c,
        })),
        tableColorRange,
        { rowHeight: 22 }
      );

      // -------------------------------------------------------------
      // 7) Draw the footer (location & page number) on the current page
      // -------------------------------------------------------------
      drawFooter(doc, location, pageNumber);

      // -------------------------------------------------------------
      // 8) Finalize the PDF (triggers the 'end' event)
      // -------------------------------------------------------------
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { DataService } from 'src/data/data.service';
import { ReportsTemplatesService } from 'src/reports_templates/reports_templates.service';

@Injectable()
export class PdfService {
  constructor(
    private readonly dataService: DataService,
    private readonly reportsTemplatesService: ReportsTemplatesService
  ) {}

  public async createPdfBinary(user_id: string, devEui: string): Promise<Buffer> {
    if (!user_id) throw new Error('User ID is required');
    if (!devEui) throw new Error('DevEui is required');

    const { reportString, reportData } = await this.fetchDataAndReportFromDB(devEui, user_id);

    // Create a PDFDocument
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    });

    // Optional: set a custom font
    doc.font('src/assets/fonts/Noto_Sans_JP/static/NotoSansJP-Regular.ttf');

    // ----------------------------------------------------------------
    // EXAMPLE PAGE (CHART, ETC.) -- skip details for brevity
    // ----------------------------------------------------------------
    doc.addPage()
      .fontSize(20)
      .text('こんにちは、PDFKitへようこそ！ (Sample Page)', 100, 100);

    // ----------------------------------------------------------------
    // MULTI-COLUMN TABLE WITH BORDERS
    // ----------------------------------------------------------------
    doc.addPage();
    doc.fontSize(16).text('Data Table (Stable Multi-Column)', { align: 'center' });
    doc.moveDown(1);

    // We'll manage the table's position ourselves
    const startX = doc.page.margins.left;
    let currentY = doc.y; // we can pick up the current doc.y after the title
    const availablePageHeight = doc.page.height - doc.page.margins.bottom;

    // -- Table geometry --
    const pairWidth = 160;          // total width of each 2-column pair
    const dateTimeColWidth = 100;
    const tempColWidth = 60;
    const rowHeight = 20;
    const cellPadding = 5;

    // How many pairs fit across the page?
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pairsAcross = Math.floor(pageWidth / pairWidth);

    // Draw the initial header row
    this.drawTableHeaders(
      doc,
      startX,
      currentY,
      pairsAcross,
      pairWidth,
      dateTimeColWidth,
      tempColWidth,
      rowHeight,
      cellPadding
    );

    // Move down after headers
    currentY += rowHeight;

    // Keep track of how many rows (in total) we’ve drawn so far
    let itemsDrawn = 0;

    for (let i = 0; i < reportData.length; i++) {
      // Calculate column pair index and row index
      const pairIndex = i % pairsAcross;
      const rowIndex = Math.floor(i / pairsAcross);

      // Calculate the absolute X for this cell pair
      const cellX = startX + pairIndex * pairWidth;
      // Calculate the absolute Y for this row
      const rowY = currentY + rowIndex * rowHeight;

      // If the next row would exceed the page, create a new page
      if (rowY + rowHeight > availablePageHeight) {
        doc.addPage();
        // Reset currentY to top margin
        currentY = doc.page.margins.top;

        // Draw the headers again at the top of new page
        this.drawTableHeaders(
          doc,
          startX,
          currentY,
          pairsAcross,
          pairWidth,
          dateTimeColWidth,
          tempColWidth,
          rowHeight,
          cellPadding
        );

        currentY += rowHeight; // move below header
        // Recompute rowIndex on the new page as if starting fresh
        // (We’ve drawn i items so far.)
        // So the item at i should now be in rowIndex=0:
        const newRowIndex = 0;
        const newPairIndex = i % pairsAcross;
        const newCellX = startX + newPairIndex * pairWidth;
        const newRowY = currentY + newRowIndex * rowHeight;

        // Draw one row
        this.drawRow(
          doc,
          newCellX,
          newRowY,
          rowHeight,
          dateTimeColWidth,
          tempColWidth,
          cellPadding,
          reportData[i]
        );

        // Advance the loop
        itemsDrawn = i + 1;
        // After this item is drawn, we must draw the rest. Let's do it in a helper:
        const remaining = reportData.slice(itemsDrawn);
        this.drawRemainingRows(
          doc,
          remaining,
          pairsAcross,
          pairWidth,
          rowHeight,
          dateTimeColWidth,
          tempColWidth,
          cellPadding
        );
        break; // stop the for-loop
      }

      // If it fits on the current page, just draw it
      this.drawRow(
        doc,
        cellX,
        rowY,
        rowHeight,
        dateTimeColWidth,
        tempColWidth,
        cellPadding,
        reportData[i]
      );
      itemsDrawn++;
    }

    // End the PDF
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));
      doc.end();
    });
  }

  /**
   * Draws the headers for the multi-column table.
   */
  private drawTableHeaders(
    doc: PDFDocument,
    startX: number,
    startY: number,
    pairsAcross: number,
    pairWidth: number,
    dateTimeColWidth: number,
    tempColWidth: number,
    rowHeight: number,
    padding: number
  ) {
    for (let i = 0; i < pairsAcross; i++) {
      const cellX = startX + i * pairWidth;

      // Date/Time header cell
      this.drawCell(
        doc,
        cellX,
        startY,
        dateTimeColWidth,
        rowHeight,
        'Date/Time',
        padding,
        'left',
        true
      );

      // Temp (°C) header cell
      this.drawCell(
        doc,
        cellX + dateTimeColWidth,
        startY,
        tempColWidth,
        rowHeight,
        'Temp (°C)',
        padding,
        'right',
        true
      );
    }
  }

  /**
   * Draws one data row (two cells: Date/Time & Temp).
   */
  private drawRow(
    doc: PDFDocument,
    x: number,
    y: number,
    rowHeight: number,
    dateTimeColWidth: number,
    tempColWidth: number,
    padding: number,
    entry: any
  ) {
    const dateTimeStr =
      entry.created_at.split('T')[0] + ' ' + entry.created_at.split('T')[1].split('.')[0];
    const tempStr = entry.temperatureC.toFixed(2);

    // Draw date/time cell
    this.drawCell(doc, x, y, dateTimeColWidth, rowHeight, dateTimeStr, padding, 'left', false);

    // Draw temperature cell
    this.drawCell(
      doc,
      x + dateTimeColWidth,
      y,
      tempColWidth,
      rowHeight,
      tempStr,
      padding,
      'right',
      false
    );
  }

  /**
   * Draws all remaining rows (after a page break).
   */
  private drawRemainingRows(
    doc: PDFDocument,
    data: any[],
    pairsAcross: number,
    pairWidth: number,
    rowHeight: number,
    dateTimeColWidth: number,
    tempColWidth: number,
    padding: number
  ) {
    let currentY = doc.page.margins.top + rowHeight; // just below headers
    const availablePageHeight = doc.page.height - doc.page.margins.bottom;
    const startX = doc.page.margins.left;

    for (let i = 0; i < data.length; i++) {
      const pairIndex = i % pairsAcross;
      const rowIndex = Math.floor(i / pairsAcross);

      const cellX = startX + pairIndex * pairWidth;
      const rowY = currentY + rowIndex * rowHeight;

      if (rowY + rowHeight > availablePageHeight) {
        doc.addPage();
        // Draw headers again
        this.drawTableHeaders(
          doc,
          startX,
          doc.page.margins.top,
          pairsAcross,
          pairWidth,
          dateTimeColWidth,
          tempColWidth,
          rowHeight,
          padding
        );
        // The new rows start below the headers
        currentY = doc.page.margins.top + rowHeight;

        // Draw the rest on the new page
        const remaining = data.slice(i);
        this.drawRemainingRows(
          doc,
          remaining,
          pairsAcross,
          pairWidth,
          rowHeight,
          dateTimeColWidth,
          tempColWidth,
          padding
        );
        return;
      }

      // Draw row
      this.drawRow(
        doc,
        cellX,
        rowY,
        rowHeight,
        dateTimeColWidth,
        tempColWidth,
        padding,
        data[i]
      );
    }
  }

  /**
   * Draws a single cell (border + text with padding).
   * We do absolute positioning so we don't rely on doc.x or doc.y.
   */
  private drawCell(
    doc: PDFDocument,
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    padding: number,
    align: 'left' | 'center' | 'right' | 'justify',
    isHeader: boolean
  ) {
    // 1) Draw border rect
    doc
      .lineWidth(1)
      .strokeColor('black')
      .rect(x, y, width, height)
      .stroke();

    // 2) Set font for header vs. body
    if (isHeader) {
      doc.font('Helvetica-Bold').fontSize(12);
    } else {
      doc.font('Helvetica').fontSize(10);
    }

    // 3) Draw text at an absolute position, with padding
    //    The { width: width - 2*padding, align } ensures it stays within the cell
    doc.text(text, x + padding, y + padding, {
      width: width - 2 * padding,
      align,
      // By specifying (x, y) we do absolute positioning.
      // This *does* move doc.x / doc.y internally, but we don't use them.
    });
  }

  /**
   * Query data from DB
   */
  private async fetchDataAndReportFromDB(devEui: string, user_id: string) {
    // Example: fetch 10 items
    const reportData = await this.dataService.findAll(
      { devEui, skip: 0, take: 10, order: 'ASC' },
      user_id
    );
    const reportJsonResponse = await this.reportsTemplatesService.getReportTemplateByDevEui(
      devEui
    );
    const reportString = JSON.stringify(reportJsonResponse.template);
    return { reportString, reportData };
  }
}

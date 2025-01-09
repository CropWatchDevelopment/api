import { pdfReportFormat } from '../interfaces/report.interface';
import { drawSignatureBoxes } from './drawSignatureBoxes';

/**
 * Draws the "Report Summary" text for company/department/location/sensor (unchanged),
 * then draws a table (50% width, no vertical borders, horizontal lines only),
 * then the signature boxes on the right.
 */
export function drawHeaderAndSignatureBoxes(
  doc: PDFKit.PDFDocument,
  data: pdfReportFormat
) {
  // 1) Save the starting position
  const startX = doc.x;
  const startY = doc.y;

  // We'll compute how wide the main content area is (page minus left/right margins)
  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // The left portion is 60% for the top text, but for the "stats table" we only want 50% width
  // so let's define some partial widths:
  const headerTableWidth = availableWidth * 0.6;   // for the "Report Summary"
  const statsTableWidth = availableWidth * 0.5;    // for the horizontal-line table

  // -------------------------------------------------------------------------
  // 2) Draw the "Report Summary" (left side) -- same as before
  // -------------------------------------------------------------------------
  doc.save();

  doc.fontSize(14).text('Report Summary', startX, startY, { width: headerTableWidth });
  doc.moveDown(1);

  doc.fontSize(10);
  doc.text(`Company: ${data.company}`, { width: headerTableWidth });
  if (data.department) {
    doc.text(`Department: ${data.department}`, { width: headerTableWidth });
  }
  doc.text(`Location: ${data.useageLocation}`, { width: headerTableWidth });
  doc.text(`Sensor: ${data.sensorName}`, { width: headerTableWidth });

  // We'll stop here—no more "Normal / Notice / Warning / Alert" lines
  // because we want them in the table now.
  //
  // Keep track of how far down we've gone
  const summaryBottomY = doc.y;

  doc.restore();

  // -------------------------------------------------------------------------
  // 3) Draw the signature boxes on the RIGHT, aligned with the top= startY
  // -------------------------------------------------------------------------
  doc.save();
  doc.y = startY;
  drawSignatureBoxes(doc);
  // That function places itself on the far right and moves doc.y below the boxes.
  doc.restore();

  // We see how far the signature boxes extended
  const sigBoxesBottomY = doc.y;

  // The top region's bottom is whichever is greater
  const topBottom = sigBoxesBottomY; //Math.max(summaryBottomY, sigBoxesBottomY);
  doc.y = topBottom; // small gap

  // -------------------------------------------------------------------------
  // 4) Draw the "stats" table at 50% page width (on the LEFT). No vertical lines.
  //    Each row has a bottom horizontal border except the last one.
  // -------------------------------------------------------------------------
  doc.save();

  // We'll define rows for:
  //  - "Total Data Points: ..."
  //  - "Date Range: ..."
  //  - "Normal: ..."
  //  - "Notice: ..."
  //  - "Warning: ..."
  //  - "Alert: ..."
  //  - "Max: ..."
  //  - "Min: ..."
  //  - "Avg: ..."
  //  - "StdDiv: ..."
  const statsRows = [
    `Total Data Points: ${data.totalDatapoints}`,
    `Date Range: ${data.dateRange}`,
    `Normal: ${data.normal} (${data.normalPercentage.toFixed(2)}%)`,
    `Notice: ${data.notice} (${data.noticePercentage.toFixed(2)}%)`,
    `Warning: ${data.warning} (${data.warningPercentage.toFixed(2)}%)`,
    `Alert: ${data.alert} (${data.alertPercentage.toFixed(2)}%)`,
    `Max: ${data.max}`,
    `Min: ${data.min}`,
    `Avg: ${data.avg.toFixed(2)}`,
    `StdDiv: ${data.stdDiv.toFixed(2)}`
  ];

  // We'll define a row height
  const rowHeight = 18;
  const tableLeft = doc.page.margins.left-5;   // current x
  const tableTop = doc.y;    // current y
  let currentY = tableTop;

  // For each row, we place the text, then draw a horizontal line below (except last row).
  statsRows.forEach((rowText, i) => {
    // Place the text
    if (i === 0) {
        doc.fontSize(14).text('コメント:', (doc.page.width/2) + 25, doc.y, { width: 100 });
    }
    doc.fontSize(10)
       .text(rowText, tableLeft + 5, currentY + 3, {
         width: statsTableWidth - 10,
         ellipsis: true
       });

    // If NOT the last row, draw a horizontal line across
    if (i < statsRows.length - 1) {
      doc
        .moveTo(tableLeft, currentY + rowHeight) // start
        .lineTo(tableLeft + statsTableWidth, currentY + rowHeight) // end
        .lineWidth(1)
        .strokeColor('black')
        .stroke();
    }
    // Move down
    currentY += rowHeight;
  });

  // The bottom of the table
  const statsTableBottomY = currentY;
  doc.restore();

  // -------------------------------------------------------------------------
  // 5) Move doc.y below the table if it's taller than the signature or summary
  // -------------------------------------------------------------------------
  const finalBottom = Math.max(statsTableBottomY, doc.y);
  doc.y = finalBottom + 20; // extra space
}

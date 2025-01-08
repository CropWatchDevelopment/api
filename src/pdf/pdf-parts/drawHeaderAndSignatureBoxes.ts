import { pdfReportFormat } from '../interfaces/report.interface';
import { drawSignatureBoxes } from './drawSignatureBoxes';


export function drawHeaderAndSignatureBoxes(
  doc: PDFKit.PDFDocument,
  data: pdfReportFormat
) {
  // 1) Save start position
  const startX = doc.x;
  const startY = doc.y;

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const headerTableWidth = pageWidth * 0.6; // 60% for the header

  // -------------------------------------------------------------------------
  // 2) Draw header on the LEFT
  // -------------------------------------------------------------------------
  doc.save();

  // Constrain text width for the header table
  doc.fontSize(14).text('Report Summary', startX, startY, { width: headerTableWidth });
  doc.moveDown(1);

  doc.fontSize(10);
  doc.text(`Company: ${data.company}`, { width: headerTableWidth });
  if (data.department) {
    doc.text(`Department: ${data.department}`, { width: headerTableWidth });
  }
  doc.text(`Location: ${data.useageLocation}`, { width: headerTableWidth });
  doc.text(`Sensor: ${data.sensorName}`, { width: headerTableWidth });

  doc.moveDown();
  doc.text(`Total Data Points: ${data.totalDatapoints}`, { width: headerTableWidth });
  doc.text(`Date Range: ${data.dateRange}`, { width: headerTableWidth });
  doc.moveDown();

  doc.text(`Normal: ${data.normal} (${data.normalPercentage.toFixed(2)}%)`, {
    width: headerTableWidth
  });
  doc.text(`Notice: ${data.notice} (${data.noticePercentage.toFixed(2)}%)`, {
    width: headerTableWidth
  });
  doc.text(`Warning: ${data.warning} (${data.warningPercentage.toFixed(2)}%)`, {
    width: headerTableWidth
  });
  doc.text(`Alert: ${data.alert} (${data.alertPercentage.toFixed(2)}%)`, {
    width: headerTableWidth
  });
  doc.moveDown();

  doc.text(`Max: ${data.max}`, { width: headerTableWidth });
  doc.text(`Min: ${data.min}`, { width: headerTableWidth });
  doc.text(`Avg: ${data.avg.toFixed(2)}`, { width: headerTableWidth });
  doc.text(`StdDiv: ${data.stdDiv.toFixed(2)}`, { width: headerTableWidth });

  // Keep track of how far down we've gone
  const headerTableBottomY = doc.y;

  doc.restore();

  // -------------------------------------------------------------------------
  // 3) Draw the signature boxes on the RIGHT, aligned with the top= startY
  // -------------------------------------------------------------------------
  // If you want them to start EXACTLY at the same top line:
  doc.save();
  doc.x = doc.x; // or doc.x = some custom coordinate if you need an offset
  doc.y = startY; 
  drawSignatureBoxes(doc); 
  // The function itself will place them on the far right 
  // and bump doc.y after finishing.
  doc.restore();

  // -------------------------------------------------------------------------
  // 4) The signatureBoxes function will move doc.y below the entire signature area.
  //    But we also need to ensure doc.y accounts for the header if it was taller.

  // doc.y AFTER the signature boxes is already below them.
  // We take the max of the header bottom Y vs. doc.y
  const finalBottom = Math.max(headerTableBottomY, doc.y);
  doc.y = finalBottom + 20; // add some extra space if you like
}

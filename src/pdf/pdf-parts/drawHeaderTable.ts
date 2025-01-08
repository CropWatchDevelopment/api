import { pdfReportFormat } from "../interfaces/report.interface";

export function drawHeaderTable(doc: PDFKit.PDFDocument, data: pdfReportFormat) {
    const startX = doc.x; 
    const startY = doc.y;
    const lineHeight = 15;
  
    // Title or some heading if desired
    doc.fontSize(14).text('Report Summary', { underline: true });
    doc.moveDown(1);
  
    // We can tabulate by manually spacing text or using doc.text with x, y coordinates
    doc.fontSize(10);
  
    // Basic info
    doc.text(`Company: ${data.company}`, startX, doc.y);
    if (data.department) {
      doc.text(`Department: ${data.department}`, { continued: true, align: 'right' });
    }
    doc.moveDown();
    doc.text(`Location: ${data.useageLocation}`, startX, doc.y);
    doc.text(`Sensor: ${data.sensorName}`, { continued: true, align: 'right' });
    doc.moveDown();
  
    // Key numeric values
    doc.text(`Normal: ${data.normal} (${data.normalPercentage}%)`, startX, doc.y);
    doc.text(`Notice: ${data.notice} (${data.noticePercentage}%)`, { continued: true, align: 'right' });
    doc.moveDown();
    doc.text(`Warning: ${data.warning} (${data.warningPercentage}%)`, startX, doc.y);
    doc.text(`Alert: ${data.alert} (${data.alertPercentage}%)`, { continued: true, align: 'right' });
    doc.moveDown();
  
    // Statistics
    doc.text(`Max: ${data.max}`, startX, doc.y);
    doc.text(`Min: ${data.min}`, { continued: true, align: 'right' });
    doc.moveDown();
    doc.text(`Avg: ${data.avg.toFixed(2)}`, startX, doc.y);
    doc.text(`StdDiv: ${data.stdDiv.toFixed(2)}`, { continued: true, align: 'right' });
    
    doc.moveDown(2); // Some spacing before the next section
  }
  
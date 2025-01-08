export function drawDataPointsTable(
    doc: PDFKit.PDFDocument,
    dataPoints: { date: Date; value: number; comment?: string }[]
  ) {
    if (!dataPoints || !dataPoints.length) return;
  
    // Sort by date ascending
    dataPoints.sort((a, b) => a.date.getTime() - b.date.getTime());
  
    // Some layout configs
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pageHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
  
    const colWidth = 180; // width per column
    const rowHeight = 20;
    const maxY = doc.page.margins.top + pageHeight;
    const startX = doc.x; 
    let currentX = startX;
    let currentY = doc.y;
  
    // Draw a heading cell for "測定日時" or any needed label?
    // This could be optional or stylized differently.
    doc.fontSize(10).text('測定日時', currentX, currentY);
    currentY += rowHeight;
  
    // Draw the sub-header row: (日時 | 値 | コメント)
    drawRowBorder(doc, currentX, currentY, colWidth, rowHeight);
    doc.text('日時', currentX + 2, currentY + 5, { width: 60 });
    doc.text('値', currentX + 64, currentY + 5, { width: 40 });
    doc.text('コメント', currentX + 106, currentY + 5, { width: 70 });
    currentY += rowHeight;
  
    // Helper to handle column overflow
    const moveToNextColumn = () => {
      currentX += colWidth;
      currentY = doc.y; // or doc.page.margins.top, if you want consistent top
      // If we exceed pageWidth, start a new page
      if (currentX + colWidth > doc.page.width - doc.page.margins.right) {
        doc.addPage();
        currentX = doc.page.margins.left;
        currentY = doc.page.margins.top;
      }
  
      // Draw the sub-header again for the new column
      doc.fontSize(10).text('測定日時', currentX, currentY);
      currentY += rowHeight;
      drawRowBorder(doc, currentX, currentY, colWidth, rowHeight);
      doc.text('日時', currentX + 2, currentY + 5, { width: 60 });
      doc.text('値', currentX + 64, currentY + 5, { width: 40 });
      doc.text('コメント', currentX + 106, currentY + 5, { width: 70 });
      currentY += rowHeight;
    };
  
    // Render each row
    dataPoints.forEach((dp) => {
      // Check if we need a new column
      if (currentY + rowHeight > maxY) {
        moveToNextColumn();
      }
  
      // Draw the row border
      drawRowBorder(doc, currentX, currentY, colWidth, rowHeight);
  
      // Format date as YY/MM/DD HH:mm (example)
      const dateString = formatDate(dp.date); 
      doc.text(dateString, currentX + 2, currentY + 5, { width: 60 });
      doc.text(dp.value.toFixed(2), currentX + 64, currentY + 5, { width: 40 });
      doc.text(dp.comment || '', currentX + 106, currentY + 5, { width: 70 });
  
      currentY += rowHeight;
    });
  
    // Optionally, move doc.y below the table
    doc.y = currentY + 10;
  }
  
  /**
   * Draw a 1px rectangle border for the row.
   */
  function drawRowBorder(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    height: number
  ) {
    doc
      .lineWidth(1)
      .strokeColor('black')
      .rect(x, y, width, height)
      .stroke();
  }
  
  /**
   * Utility to format date as YY/MM/DD HH:mm
   */
  function formatDate(d: Date): string {
    // Example: 2024/10/01 00:05 => "24/10/01 00:05"
    const year = String(d.getFullYear()).slice(-2); // last two digits
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${mins}`;
  }
  
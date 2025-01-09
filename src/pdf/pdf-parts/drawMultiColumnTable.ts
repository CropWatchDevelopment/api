interface DataRow {
  createdAt: string;
  temperature: number;
}

/**
 * Draws a multi-column table:
 *   - Each "column set" has 2 columns: createdAt, temperature
 *   - We fill top→bottom in each set
 *   - Then move left→right to the next set on the same page if there's room
 *   - If no more horizontal space, add a new page, continue at top-left
 *   - Each cell has a border, and text is clipped (ellipsis) if it doesn't fit
 */
export function drawDataTable(
  doc: PDFKit.PDFDocument,
  data: DataRow[],
  options?: {
    rowHeight?: number;
    headerHeight?: number;
    marginBottom?: number;
  }
) {
  if (!data || data.length === 0) return;

  // We’ll define some column widths:
  // "createdAt" = 120px, "temperature" = 80px
  const colWidthDate = 120;
  const colWidthTemp = 80;
  const setWidth = colWidthDate + colWidthTemp; // total width for one 2-col set

  // Row & header dimensions
  const rowHeight = options?.rowHeight ?? 20;
  const headerHeight = options?.headerHeight ?? 20;
  const marginBottom = options?.marginBottom ?? 20;

  // Page geometry
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const marginLeft = doc.page.margins.left;
  const marginRight = doc.page.margins.right;
  const marginTop = doc.page.margins.top;
  const marginBot = doc.page.margins.bottom;

  // Ensure we’re starting near the left margin
  // (If doc.x is already offset, you can override it here)
  doc.x = marginLeft;

  // Current coordinates
  let currentX = doc.x;
  let currentY = doc.y;

  // Usable page size
  const usableWidth = pageWidth - marginLeft - marginRight;
  const usableHeight = pageHeight - marginTop - marginBot;

  // How many column sets fit horizontally?
  // e.g. if setWidth=200, usableWidth=600 => we can fit 3 sets
  const setsPerRow = Math.floor(usableWidth / setWidth);
  if (setsPerRow < 1) {
    // If we can’t fit at least one 2-col set, you might bail or handle differently
    doc.addPage();
    doc.x = marginLeft;
    doc.y = marginTop;
    return;
  }

  // How many “body” rows fit vertically, ignoring the header row?
  // E.g., each row is rowHeight, plus 1 header row of headerHeight
  const maxBodyRows = Math.floor((usableHeight - headerHeight) / rowHeight);
  if (maxBodyRows < 1) {
    // If we can’t fit even 1 row, new page
    doc.addPage();
    doc.x = marginLeft;
    doc.y = marginTop;
    return;
  }

  // This is the total # of rows we can place in one column set on a single page
  // (1 header row + maxBodyRows data rows)
  // Actually, we handle the header separately each time we start a new set
  // so the data rows are maxBodyRows per set.
  //
  // Now let’s iterate over our data, top→bottom in each set, left→right across sets.
  let dataIndex = 0;
  const total = data.length;

  // Helper: draw one “header row” for a set
  function drawHeader(x: number, y: number) {
    doc.fontSize(10).font('Helvetica-Bold');

    // 1) "createdAt" col
    drawCellBorder(doc, x, y, colWidthDate, headerHeight);
    doc.text('Created At', x + 4, y + 5, {
      width: colWidthDate - 8,
      ellipsis: true
    });

    // 2) "temperature" col
    drawCellBorder(doc, x + colWidthDate, y, colWidthTemp, headerHeight);
    doc.text('Temp (C)', x + colWidthDate + 4, y + 5, {
      width: colWidthTemp - 8,
      ellipsis: true
    });
  }

  // Helper: draw one “data row” for a set
  function drawDataRow(x: number, y: number, row: DataRow) {
    doc.fontSize(10).font('Helvetica');

    // date col
    drawCellBorder(doc, x, y, colWidthDate, rowHeight);
    doc.text(row.createdAt, x + 4, y + 5, {
      width: colWidthDate - 8,
      ellipsis: true
    });

    // temp col
    drawCellBorder(doc, x + colWidthDate, y, colWidthTemp, rowHeight);
    doc.text(String(row.temperature), x + colWidthDate + 4, y + 5, {
      width: colWidthTemp - 8,
      ellipsis: true
    });
  }

  // Helper: check if we need a new page
  function ensureSpaceForSetsRow(): void {
    // If currentY + (headerHeight + maxBodyRows * rowHeight) > bottom,
    // we add a new page and reset X/Y.
    const needed = headerHeight + maxBodyRows * rowHeight + 20; // some margin
    const bottomLimit = pageHeight - marginBot;
    if (currentY + needed > bottomLimit) {
      doc.addPage();
      currentX = marginLeft;
      currentY = doc.page.margins.top;
    }
  }

  // While we have data left:
  while (dataIndex < total) {
    // We do an entire “row” of sets, up to setsPerRow horizontally.
    ensureSpaceForSetsRow();

    // For each set in that row of sets:
    for (let setIndex = 0; setIndex < setsPerRow; setIndex++) {
      if (dataIndex >= total) break; // no more data

      // 1) Draw header
      drawHeader(currentX, currentY);

      // 2) Fill up to maxBodyRows data rows
      let yPos = currentY + headerHeight; // the first data row is below the header

      for (let r = 0; r < maxBodyRows; r++) {
        if (dataIndex >= total) break;

        drawDataRow(currentX, yPos, data[dataIndex]);

        dataIndex++;
        yPos += rowHeight;
      }

      // Move currentX to the next set horizontally
      currentX += setWidth;

      // If we used up all data, exit
      if (dataIndex >= total) break;
    }

    // We finished a row of sets. Move currentY down by the total used height
    // That’s the header + the data rows we allocated (maxBodyRows)
    currentY += headerHeight + (maxBodyRows * rowHeight);

    // Reset currentX to the left margin
    currentX = marginLeft;
  }

  // Finally, move doc.y below the table for subsequent content
  doc.y = currentY + marginBottom;
}

/**
 * Draws a 1px rectangle border for the cell at (x, y) with w/h
 */
function drawCellBorder(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number) {
  doc
    .lineWidth(1)
    .strokeColor('black')
    .rect(x, y, w, h)
    .stroke();
}

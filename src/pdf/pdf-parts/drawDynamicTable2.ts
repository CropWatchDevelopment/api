export interface TableHeader {
  /** The key in the data row to display. */
  key: string;
  /** The label for the header cell. */
  label: string;
  /** Optional width of the column in points. If not given, use a default. */
  width?: number;
  /** Optional background color for the header cell. */
  backgroundColor?: string;
}

export interface TableColorRange {
  name: string;
  min: number;
  max: number;
  color: string;
}

export interface DataRow {
  [key: string]: any;
}





export function drawDynamicDataTable2(
  doc: PDFKit.PDFDocument,
  headers: TableHeader[],
  data: DataRow[],
  colorRanges: TableColorRange[],
  options?: {
    rowHeight?: number;
    headerHeight?: number;
    marginBottom?: number;
    headerFontSize?: number;
    bodyFontSize?: number;
  }
) {
  if (!data?.length || !headers?.length) return;

  // Options
  const headerHeight = options?.headerHeight ?? 16;
  const rowHeight = options?.rowHeight ?? 16;
  const marginBottom = options?.marginBottom ?? 20;
  const headerFontSize = options?.headerFontSize ?? 6;
  const bodyFontSize = options?.bodyFontSize ?? 6;

  // Page geometry
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const marginLeft = doc.page.margins.left;
  const marginRight = doc.page.margins.right;
  const marginTop = doc.page.margins.top;
  const marginBot = doc.page.margins.bottom;

  let currentX = doc.x; 
  let currentY = doc.y; 

  const usableWidth = pageWidth - marginLeft - marginRight;
  const usableHeight = pageHeight - marginTop - marginBot;

  // For each column in headers, determine the width
  // default ~50 if not specified
  const defaultColWidth = 50;
  const columns = headers.map((col) => ({
    ...col,
    width: col.width ?? defaultColWidth
  }));

  // Sum columns to find total "set" width
  const setWidth = columns.reduce((sum, c) => sum + c.width, 0);

  // Determine how many sets fit horizontally
  // e.g., if setWidth=130, usableWidth=500 => 3 sets => 390 used
  // We'll fill setsPerRow from left to right
  const setsPerRow = Math.floor(usableWidth / setWidth);

  // If none fits, we might just let it overflow or handle differently
  if (setsPerRow < 1) {
    // For now, let's let it overflow. Or you can do doc.addPage() etc.
  }

  // How many rows (body) fit vertically? 
  // The user might want 1 header row + maxBodyRows data. We do:
  const maxBodyRows = Math.floor((usableHeight - headerHeight) / rowHeight);
  if (maxBodyRows < 1) {
    // not enough vertical space => new page
    doc.addPage();
    doc.x = marginLeft;
    doc.y = marginTop;
    return;
  }

  // Our data pointer
  let dataIndex = 0;
  const total = data.length;

  // Draw function for one "set" => draws the header, then up to maxBodyRows data
  function drawOneSet(x: number, y: number) {
    // 1) Draw header (all columns)
    doc.fontSize(headerFontSize).font('NotoSansJP');
    let colX = x;
    columns.forEach((col) => {
      if (col.backgroundColor) {
        doc.save();
        doc.rect(colX, y, col.width, headerHeight)
          .fillColor(col.backgroundColor)
          .fill();
        doc.restore();
      }
      drawCellBorder(doc, colX, y, col.width, headerHeight);
      doc.text(col.label, colX + 2, y + 2, {
        width: col.width - 4,
        ellipsis: true
      });
      colX += col.width;
    });

    let bodyY = y + headerHeight;
    doc.fontSize(bodyFontSize).font('NotoSansJP');

    // 2) Fill up to maxBodyRows
    const rowsThisSet = Math.min(total - dataIndex, maxBodyRows);
    for (let i = 0; i < rowsThisSet; i++) {
      const rowData = data[dataIndex];
      let cX = x;
      for (const col of columns) {
        // possibly color fill if we want 
        // (like if col.key === 'temperature', check colorRanges, etc.)
        // We'll check if rowData[col.key] is numeric and fill color if in range
        const val = rowData[col.key] ?? '';
        if (typeof val === 'number') {
          fillCellColorIfInRange(doc, cX, bodyY, col.width, rowHeight, val, colorRanges);
        }

        drawCellBorder(doc, cX, bodyY, col.width, rowHeight);
        doc.text(String(val), cX + 2, bodyY + 2, {
          width: col.width - 4,
          ellipsis: true
        });
        cX += col.width;
      }
      bodyY += rowHeight;
      dataIndex++;
      if (dataIndex >= total) break;
    }

    // Return how far we ended
    return bodyY;
  }

  // Before we loop, if you want to do any alert lines or something, do it here
  // e.g. doc.text(...)

  // The main loop: While we have data, we fill setsPerRow sets horizontally
  while (dataIndex < total) {
    // Check if we have enough vertical space for 1 set (header + maxBodyRows)
    const needed = headerHeight + maxBodyRows * rowHeight;
    if (currentY + needed > (pageHeight - marginBot)) {
      // new page
      doc.addPage();
      currentX = marginLeft;
      currentY = marginTop;
    }

    for (let s = 0; s < setsPerRow; s++) {
      if (dataIndex >= total) break; 
      // draw one set at (currentX, currentY)
      const bottomY = drawOneSet(currentX, currentY);
      // move X to the next set
      currentX += setWidth;
      if (dataIndex >= total) break;
    }

    // after finishing a row of sets, move down
    currentY += (headerHeight + maxBodyRows * rowHeight);
    // reset X
    currentX = marginLeft;
  }

  // move doc.y below the table
  doc.y = currentY + marginBottom;
}

/** Color fill if numeric value is in colorRanges. */
function fillCellColorIfInRange(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
  colorRanges: TableColorRange[]
) {
  const c = getColorForValue(value, colorRanges);
  if (c) {
    doc.save();
    doc.rect(x, y, w, h).fillColor(c).fill();
    doc.restore();
  }
}

/** Return first matching color if value is in [range.min, range.max]. */
function getColorForValue(value: number, ranges: TableColorRange[]): string | null {
  for (const r of ranges) {
    if (value >= r.min && value <= r.max) return r.color;
  }
  return null;
}

/** Draw a 1px black border for a cell. */
function drawCellBorder(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number
) {
  doc.lineWidth(1).strokeColor('black').rect(x, y, w, h).stroke();
}

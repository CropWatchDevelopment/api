import { TableColorRange } from "../interfaces/TableColorRange";

interface DataRow {
  createdAt: string;
  temperature: number;
  comment?: string;
}

/**
 * Draws a multi-"column set" table in PDFKit:
 * - Each "column set" = 3 columns: [Created At, Temp (C), コメント].
 * - 12 columns total => 4 sets horizontally (4 sets × 3 columns = 12).
 * - Rows fill top→bottom in each set, then left→right across sets.
 * - If no more space horizontally, we add a new page and continue at top-left.
 * - Each cell has a border; text is clipped if it doesn't fit.
 * - Default font size is 6pt (both header & body).
 * - We add a color fill on the **temperature** cell if it matches any range in `colorRanges`.
 */
export function drawDataTable12Cols(
  doc: PDFKit.PDFDocument,
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
  if (!data?.length) return;

  // 3 columns per set:
  // "Created At", "Temp (C)", "コメント"
  const colWidthDate = 55;
  const colWidthTemp = 27;
  const colWidthComment = 40;
  const setWidth = colWidthDate + colWidthTemp + colWidthComment;

  // 4 sets horizontally => 12 columns total
  const setsPerRow = 4;

  // Row / header dimensions
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

  // Start near the left margin
  doc.x = marginLeft;
  let currentX = doc.x;
  let currentY = doc.y;

  const usableWidth = pageWidth - marginLeft - marginRight;
  const usableHeight = pageHeight - marginTop - marginBot;

  // Check if 4 sets fit horizontally (4 sets × setWidth)
  const totalWidthNeeded = setsPerRow * setWidth;
  if (totalWidthNeeded > usableWidth) {
    // Potentially handle "not enough horizontal space" case
    // For now, we'll just continue and let it overflow or you can scale widths.
  }

  // How many rows fit vertically?
  const maxBodyRows = Math.floor((usableHeight - headerHeight) / rowHeight);
  if (maxBodyRows < 1) {
    doc.addPage();
    doc.x = marginLeft;
    doc.y = marginTop;
    return;
  }

  let dataIndex = 0;
  const total = data.length;

  /**
   * Draws the header row for one set (3 columns).
   */
  function drawHeader(x: number, y: number) {
    doc.fontSize(headerFontSize).font('NotoSansJP');

    let alertBreakPointString = colorRanges.map((d) => `     ${d.name}: ${d.min}`).join(', ');
    doc.fontSize(10).text(alertBreakPointString, doc.page.margins.left, marginTop-30, { width: doc.page.width, height: 10 });

    // Column 1: "Created At"
    drawCellBorder(doc, x, y, colWidthDate, headerHeight);
    doc.text('日時', x + 2, y + 2, {
      width: colWidthDate - 4,
      ellipsis: true
    });

    // Column 2: "Temp (C)"
    drawCellBorder(doc, x + colWidthDate, y, colWidthTemp, headerHeight);
    doc.text('値', x + colWidthDate + 2, y + 2, {
      width: colWidthTemp - 4,
      ellipsis: true
    });

    // Column 3: "コメント"
    drawCellBorder(doc, x + colWidthDate + colWidthTemp, y, colWidthComment, headerHeight);
    doc.text('コメント', x + colWidthDate + colWidthTemp + 2, y + 2, {
      width: colWidthComment - 4,
      ellipsis: true
    });
  }

  /**
   * Draws one data row (3 columns).
   * We highlight the temperature cell background if it fits any range in colorRanges.
   */
  function drawDataRow(x: number, y: number, row: DataRow) {
    doc.fontSize(bodyFontSize).font('NotoSansJP');

    // Column 1: Created At
    drawCellBorder(doc, x, y, colWidthDate, rowHeight);
    doc.text(row.createdAt, x + 2, y + 2, {
      width: colWidthDate - 4,
      ellipsis: true
    });

    // Column 2: Temperature with color fill if it matches a range
    const tempCellX = x + colWidthDate;
    fillCellColorIfInRange(doc, tempCellX, y, colWidthTemp, rowHeight, row.temperature, colorRanges);
    drawCellBorder(doc, tempCellX, y, colWidthTemp, rowHeight);
    doc.text(String(row.temperature), tempCellX + 2, y + 2, {
      width: colWidthTemp - 4,
      ellipsis: true
    });

    // Column 3: コメント
    const commentCellX = x + colWidthDate + colWidthTemp;
    drawCellBorder(doc, commentCellX, y, colWidthComment, rowHeight);
    doc.text(row.comment ?? '', commentCellX + 2, y + 2, {
      width: colWidthComment - 4,
      ellipsis: true
    });
  }

  /**
   * Before drawing another "row of sets," ensure we have enough vertical space.
   * If not, add a new page.
   */
  function ensureSpaceForSetsRow() {
    const needed = headerHeight + maxBodyRows * rowHeight + 10; // some padding
    if (currentY + needed > pageHeight - marginBot) {
      doc.addPage();
      currentX = marginLeft;
      currentY = doc.page.margins.top;
    }
  }

  // Main loop over data
  while (dataIndex < total) {
    // Each "row of sets" has 4 sets horizontally
    ensureSpaceForSetsRow();

    for (let setIndex = 0; setIndex < setsPerRow; setIndex++) {
      if (dataIndex >= total) break;

      // Draw header
      drawHeader(currentX, currentY);
      let bodyY = currentY + headerHeight;

      // Fill up to maxBodyRows
      for (let r = 0; r < maxBodyRows; r++) {
        if (dataIndex >= total) break;

        drawDataRow(currentX, bodyY, data[dataIndex]);
        bodyY += rowHeight;
        dataIndex++;
      }

      // Move horizontally to next set
      currentX += setWidth;
      if (dataIndex >= total) break;
    }

    // Move down for next "row of sets"
    currentY += headerHeight + maxBodyRows * rowHeight;
    currentX = marginLeft;
  }

  // Move doc.y below the table
  doc.y = currentY + marginBottom;
}

/** 
 * If the numeric value is within any of the specified ranges, fill the cell with that color.
 * (We assume the colorRanges do not overlap, but if they do, the first match is used.)
 */
function fillCellColorIfInRange(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
  colorRanges: TableColorRange[]
) {
  const color = getColorForValue(value, colorRanges);
  if (color) {
    doc.save();
    doc.rect(x, y, w, h).fillColor(color).fill();
    doc.restore();
  }
}

/** Returns the first matching color if `value` is within [min, max] of a range. */
function getColorForValue(value: number, ranges: TableColorRange[]): string | null {
  for (const r of ranges) {
    if (value >= r.min && value <= r.max) {
      return r.color;
    }
  }
  return null;
}

/** Draws a 1px border around the cell at (x,y). */
function drawCellBorder(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number
) {
  doc
    .lineWidth(1)
    .strokeColor('black')
    .rect(x, y, w, h)
    .stroke();
}

/** 
 * A simple interface describing each column’s configuration 
 * (header label, field name, width, alignment, etc.). 
 * You can also derive columns automatically from data keys if you prefer. 
 */
export interface TableColumn {
  header: string;       // text shown in the header cell
  field: string;        // key in your JSON row
  width: number;        // column width in points
  align?: 'left' | 'center' | 'right'; 
}

/**
 * Draws a "dynamic" table of JSON data in PDFKit:
 * - You supply an array of `columns` (header text, field, width).
 * - You supply an array of JSON rows.
 * - It automatically paginates if you run out of vertical space.
 * - Each cell has a 1px border, and text is clipped to the cell width.
 */
export function drawDynamicTable(
  doc: PDFKit.PDFDocument,
  columns: TableColumn[],
  rows: Record<string, any>[],  // your JSON data
  options?: {
    headerHeight?: number;
    rowHeight?: number;
    fontSize?: number;
    x?: number;  // optional override for left X
    y?: number;  // optional override for start Y
    cellPadding?: number; // horizontal padding in each cell
    gapAfter?: number;  // space after the table
  }
) {
  // Default configs
  const headerHeight = options?.headerHeight ?? 20;
  const rowHeight = options?.rowHeight ?? 20;
  const fontSize = options?.fontSize ?? 10;
  const cellPadding = options?.cellPadding ?? 4;
  const gapAfter = options?.gapAfter ?? 20;

  // Starting position
  let currentX = options?.x ?? doc.x;
  let currentY = options?.y ?? doc.y;

  // Page geometry
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const marginLeft = doc.page.margins.left;
  const marginRight = doc.page.margins.right;
  const marginTop = doc.page.margins.top;
  const marginBottom = doc.page.margins.bottom;
  const usableWidth = pageWidth - marginLeft - marginRight;

  // We define a helper to check if we have enough space
  // for one more row of height rowHeight
  function ensureSpaceForRow() {
    if (currentY + rowHeight > pageHeight - marginBottom) {
      // we need a new page
      doc.addPage();
      currentY = doc.page.margins.top;
      currentX = doc.page.margins.left;
    }
  }

  doc.fontSize(fontSize).font('Helvetica'); // or your choice

  // ---------------------------------------------------------------------------
  // 1) Draw the header row
  // ---------------------------------------------------------------------------
  // Check if we have enough space for the header
  ensureSpaceForRow();

  // We'll track the original Y for the header row
  const headerY = currentY;

  columns.forEach((col) => {
    drawCellBorder(doc, currentX, headerY, col.width, headerHeight);
    doc.text(
      col.header,
      currentX + cellPadding,
      headerY + cellPadding,
      {
        width: col.width - cellPadding * 2,
        align: col.align || 'left',
        ellipsis: true
      }
    );
    currentX += col.width;
  });

  // horizontal line after the header row is done
  currentY += headerHeight;
  currentX = options?.x ?? doc.x;  // reset X to table start for data rows

  // ---------------------------------------------------------------------------
  // 2) Draw each data row
  // ---------------------------------------------------------------------------
  rows.forEach((row) => {
    ensureSpaceForRow();

    // For each column, draw a cell
    let cellX = currentX;
    columns.forEach((col) => {
      const cellValue = row[col.field] != null ? String(row[col.field]) : '';

      drawCellBorder(doc, cellX, currentY, col.width, rowHeight);

      doc.text(
        cellValue,
        cellX + cellPadding,
        currentY + cellPadding,
        {
          width: col.width - cellPadding * 2,
          align: col.align || 'left',
          ellipsis: true
        }
      );

      cellX += col.width;
    });

    currentY += rowHeight;
  });

  // ---------------------------------------------------------------------------
  // 3) Move doc.y below the table
  // ---------------------------------------------------------------------------
  doc.x = marginLeft; 
  doc.y = currentY + gapAfter;
}

/**
 * Draw a 1px border cell at (x, y) with width/height
 */
function drawCellBorder(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number) {
  doc
    .lineWidth(1)
    .strokeColor('black')
    .rect(x, y, w, h)
    .stroke();
}

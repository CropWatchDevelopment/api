interface LabelValue {
  label: string;
  value?: string; // or number
}

interface DataGroups {
  group1: LabelValue[];
  group2: LabelValue[];
  group3: LabelValue[];
  group4: LabelValue[];
}

/**
 * Draws four data groups in a single horizontal row, each with a vertical list of label/value pairs.
 * Adds vertical black lines between each pair of adjacent groups.
 */
export function drawFourDataGroups(
  doc: PDFKit.PDFDocument,
  dataGroups: DataGroups,
  options?: {
    fontSize?: number;
    rowHeight?: number;
    labelWidth?: number;
    valueWidth?: number; 
    gapBetweenCols?: number; // horizontal gap between each group
    drawColumnDividers?: boolean; // default true
  }
) {
  // Default configuration
  const fontSize = options?.fontSize ?? 10;
  const rowHeight = options?.rowHeight ?? 16;
  const labelWidth = options?.labelWidth ?? 60;  // space reserved for the label
  const valueWidth = options?.valueWidth ?? 120; // space for the value
  const gapBetweenCols = options?.gapBetweenCols ?? 20;
  const drawDividers = options?.drawColumnDividers ?? true;

  // We'll place all 4 groups on one row.
  // Each group's bounding box is labelWidth + valueWidth in width.
  const groupWidth = labelWidth + valueWidth;

  // Save the starting position
  const startX = doc.x;
  const startY = doc.y;

  // For each group, compute X positions
  const groupXPositions = [
    startX,
    startX + groupWidth + gapBetweenCols,
    startX + (groupWidth + gapBetweenCols) * 2,
    startX + (groupWidth + gapBetweenCols) * 3
  ];

  // Use a small helper to draw each group.
  doc.fontSize(fontSize).font('NotoSansJP'); // or some other font if needed

  // We'll get a "bottomY" for each group, so we know how tall it is.
  const g1BottomY = drawLabelValueList(
    doc,
    dataGroups.group1,
    groupXPositions[0],
    startY,
    labelWidth,
    valueWidth,
    rowHeight
  );
  const g2BottomY = drawLabelValueList(
    doc,
    dataGroups.group2,
    groupXPositions[1],
    startY,
    labelWidth,
    valueWidth,
    rowHeight
  );
  const g3BottomY = drawLabelValueList(
    doc,
    dataGroups.group3,
    groupXPositions[2],
    startY,
    labelWidth,
    valueWidth,
    rowHeight
  );
  const g4BottomY = drawLabelValueList(
    doc,
    dataGroups.group4,
    groupXPositions[3],
    startY,
    labelWidth,
    valueWidth,
    rowHeight
  );

  // The final bottom is the tallest group
  const finalBottomY = Math.max(g1BottomY, g2BottomY, g3BottomY, g4BottomY);

  // Optionally, draw vertical lines between columns
  if (drawDividers) {
    doc.save();
    doc.lineWidth(1).strokeColor('black');

    // lines between group1 & group2, group2 & group3, group3 & group4
    // each line from (groupXPositions[i], startY) to (groupXPositions[i], finalBottomY)
    // i = 1, 2, 3 => that is the left X of group 2, 3, 4
    for (let i = 1; i < 4; i++) {
      doc
        .moveTo(groupXPositions[i], startY)
        .lineTo(groupXPositions[i], finalBottomY)
        .stroke();
    }

    doc.restore();
  }

  // Move doc.y below all four groups
  doc.x = startX;
  doc.y = finalBottomY + 20; // add some spacing
}

/**
 * Draws a vertical list of label/value pairs at the given (x, y).
 * Returns the bottom Y after the last row is drawn.
 */
function drawLabelValueList(
  doc: PDFKit.PDFDocument,
  items: LabelValue[],
  x: number,
  y: number,
  labelWidth: number,
  valueWidth: number,
  rowHeight: number
): number {
  let currentY = y;
  const totalWidth = labelWidth + valueWidth;

  items.forEach(({ label, value }) => {
    // Optional: draw a bounding box for each row
    // doc.rect(x, currentY, totalWidth, rowHeight).stroke();

    // We can also draw a vertical line between the label & value cell if we want
    // doc
    //   .moveTo(x + labelWidth, currentY)
    //   .lineTo(x + labelWidth, currentY + rowHeight)
    //   .stroke();

    // Place label
    doc.text(label, x + 2, currentY + 2, {
      width: labelWidth - 4,
      ellipsis: true
    });

    // Place value
    doc.text(value ?? '', x + labelWidth + 2, currentY + 2, {
      width: valueWidth - 4,
      ellipsis: true
    });

    currentY += rowHeight;
  });

  return currentY;
}

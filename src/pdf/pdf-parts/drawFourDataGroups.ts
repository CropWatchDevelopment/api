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
 * Each item row is alternately shaded in 2 different gray tones.
 *
 * Also allows controlling the gap on each side of the vertical boundary 
 * between label and value (labelGap).
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
    labelGap?: number; // horizontal gap on each side of the vertical boundary
    alternateRowShading?: boolean; // default true
    shadeColor1?: string; // first row color
    shadeColor2?: string; // second row color
  }
) {
  // Default configuration
  const fontSize = options?.fontSize ?? 10;
  const rowHeight = options?.rowHeight ?? 16;
  const labelWidth = options?.labelWidth ?? 60;  // space reserved for the label
  const valueWidth = options?.valueWidth ?? 120; // space for the value
  const gapBetweenCols = options?.gapBetweenCols ?? 20;
  const drawDividers = options?.drawColumnDividers ?? true;
  const labelGap = options?.labelGap ?? 2;   // the gap on each side of the vertical boundary
  const alternateRowShading = 
    options?.alternateRowShading ?? true; // if false, no shading
  const shadeColor1 = options?.shadeColor1 ?? '#f5f5f5';
  const shadeColor2 = options?.shadeColor2 ?? '#dddddd';

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
    rowHeight,
    labelGap,
    alternateRowShading,
    shadeColor1,
    shadeColor2
  );
  const g2BottomY = drawLabelValueList(
    doc,
    dataGroups.group2,
    groupXPositions[1],
    startY,
    labelWidth,
    valueWidth,
    rowHeight,
    labelGap,
    alternateRowShading,
    shadeColor1,
    shadeColor2
  );
  const g3BottomY = drawLabelValueList(
    doc,
    dataGroups.group3,
    groupXPositions[2],
    startY,
    labelWidth,
    valueWidth,
    rowHeight,
    labelGap,
    alternateRowShading,
    shadeColor1,
    shadeColor2
  );
  const g4BottomY = drawLabelValueList(
    doc,
    dataGroups.group4,
    groupXPositions[3],
    startY,
    labelWidth,
    valueWidth,
    rowHeight,
    labelGap,
    alternateRowShading,
    shadeColor1,
    shadeColor2
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
 * 
 * labelGap is the horizontal gap on each side of the boundary between label and value.
 * 
 * If alternateRowShading is true, row 0 uses shadeColor1, row 1 uses shadeColor2, 
 * and so on, alternating.
 */
function drawLabelValueList(
  doc: PDFKit.PDFDocument,
  items: LabelValue[],
  x: number,
  y: number,
  labelWidth: number,
  valueWidth: number,
  rowHeight: number,
  labelGap: number,
  alternateRowShading: boolean,
  shadeColor1: string,
  shadeColor2: string
): number {
  let currentY = y;
  const totalWidth = labelWidth + valueWidth;

  items.forEach(({ label, value }, rowIndex) => {
    // Alternate shading
    if (alternateRowShading) {
      const fillColor = (rowIndex % 2 === 0) ? shadeColor1 : shadeColor2;
      doc.save();
      doc
        .rect(x, currentY, totalWidth, rowHeight)
        .fillColor(fillColor)
        .fill();
      doc.restore();
    }

    // If you want a bounding box or border line, you can do doc.rect(...) and stroke() here

    // Label
    doc.text(label, x + labelGap, currentY + 2, {
      width: labelWidth - labelGap * 2,
      ellipsis: true
    });

    // Value
    doc.text(value ?? '', x + labelWidth + labelGap, currentY + 2, {
      width: valueWidth - labelGap * 2,
      ellipsis: true
    });

    currentY += rowHeight;
  });

  return currentY;
}

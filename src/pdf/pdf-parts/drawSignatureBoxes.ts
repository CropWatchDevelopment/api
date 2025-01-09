/**
 * Draws a single "signature" block on the right side:
 * - A big top box labeled "日付:"
 * - A row of 3 side-by-side boxes labeled "承認", "確認", and "作成"
 */
export function drawSignatureBoxes(doc: PDFKit.PDFDocument) {
  const pageWidth = doc.page.width;
  const marginLeft = doc.page.margins.left;
  const marginRight = doc.page.margins.right;
  const usableWidth = pageWidth - marginLeft - marginRight;

  // We'll position this signature block to the far right. 
  // Adjust as needed if you are also placing other content on the left.
  // For example, if you used a 60/40 split for a header & signature area, 
  // you'd adapt those calculations accordingly.
  const signatureBlockWidth = usableWidth * 0.3; 
  const signatureBlockX = marginLeft + (usableWidth - signatureBlockWidth);

  const topY = doc.y;   // current doc.y is the top where we place this block

  // 1) Big top box
  const topBoxHeight = 40;
  doc
    .rect(signatureBlockX, topY, signatureBlockWidth, topBoxHeight)
    .stroke();

  doc
    .fontSize(10)
    .text('日付:', signatureBlockX + 5, topY + 5);

  // 2) Row of 3 sub-boxes (承認, 確認, 作成), side-by-side
  const subBoxesY = topY + topBoxHeight + 5;  // gap below the top box
  const subBoxHeight = 90;
  const labels = ['承認', '確認', '作成'];

  // We'll divide the total width by 3
  const subBoxWidth = signatureBlockWidth / 3;

  // Draw each box in a single row
  labels.forEach((label, idx) => {
    const xOffset = signatureBlockX + idx * subBoxWidth;

    doc
      .rect(xOffset, subBoxesY, subBoxWidth, subBoxHeight)
      .stroke();

    // Place text near the top-left corner of the box
    doc
      .text(label, xOffset + 5, subBoxesY + 5);
  });

  // 3) Determine the bottom of these sub-boxes
  const signatureBoxesBottomY = subBoxesY + subBoxHeight;

  // 4) Move doc.y to below this entire signature block 
  //    so subsequent content starts below it.
  doc.y = Math.max(doc.y, signatureBoxesBottomY + 20); 
  // +20 for a bit of spacing
}

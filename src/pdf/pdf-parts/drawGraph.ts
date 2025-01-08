export function drawGraph(
    doc: PDFKit.PDFDocument,
    dataPoints: { date: Date; value: number }[]
  ) {
    if (!dataPoints.length) return;
  
    // Determine chart area
    const chartMargin = 50;
    const chartWidth = 400;
    const chartHeight = 150;
  
    const startX = doc.x;
    const startY = doc.y;
  
    // Find min/max
    let minVal = Number.POSITIVE_INFINITY;
    let maxVal = Number.NEGATIVE_INFINITY;
    dataPoints.forEach((dp) => {
      if (dp.value < minVal) minVal = dp.value;
      if (dp.value > maxVal) maxVal = dp.value;
    });
  
    // Draw a bounding box
    doc
      .rect(startX, startY, chartWidth, chartHeight)
      .stroke();
  
    // Plot the points (simple left-to-right)
    const stepX = chartWidth / (dataPoints.length - 1);
  
    for (let i = 0; i < dataPoints.length; i++) {
      const dp = dataPoints[i];
      const x = startX + i * stepX;
      // Map the value to vertical position
      const y =
        startY +
        chartHeight -
        ((dp.value - minVal) / (maxVal - minVal)) * chartHeight;
  
      // Draw circle
      doc.circle(x, y, 2).fillColor('blue').fill();
  
      // Connect lines
      if (i > 0) {
        const prevDp = dataPoints[i - 1];
        const prevX = startX + (i - 1) * stepX;
        const prevY =
          startY +
          chartHeight -
          ((prevDp.value - minVal) / (maxVal - minVal)) * chartHeight;
        doc
          .moveTo(prevX, prevY)
          .lineTo(x, y)
          .strokeColor('blue')
          .stroke();
      }
    }
  
    // Move doc.y down so we don’t overlap
    doc.y += chartHeight + chartMargin;
  }
  
interface DataPoint {
  date: Date;
  value: number;
}

/**
 * Draws a line chart that spans the full page width (left margin → right margin).
 * The height extends from the current doc.y down toward the bottom margin,
 * with the X-axis tick labels rotated 90 degrees.
 */
export async function drawSimpleLineChartD3Style(
  doc: PDFKit.PDFDocument,
  data: DataPoint[]
) {
  if (!data.length) return;

  // Dynamically import D3 modules
  const d3Scale = await import('d3-scale');
  const d3Array = await import('d3-array');
  const d3TimeFormat = await import('d3-time-format');
  const d3Format = await import('d3-format');

  // Margins for the "inner" chart
  const margin = { top: 20, right: 0, bottom: 0, left: 0 };

  // Calculate available area
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const marginLeft = doc.page.margins.left;
  const marginRight = doc.page.margins.right;
  const marginBottom = doc.page.margins.bottom + 5;

  const chartLeft = marginLeft;   
  const chartTop = doc.y;         
  const chartWidth = pageWidth - marginLeft - marginRight;
  const availableHeight = pageHeight - chartTop - marginBottom;
  const chartHeight = availableHeight;

  // Draw a faint bounding box (optional)
  doc
    .save()
    .lineWidth(0.5)
    .strokeColor('#cccccc')
    .rect(chartLeft, chartTop, chartWidth, chartHeight)
    .stroke()
    .restore();

  // Inner area = chart minus "chart margins"
  const innerWidth = chartWidth - (margin.left + margin.right);
  const innerHeight = chartHeight - (margin.top + margin.bottom);

  // Top-left of the inner area
  const innerLeft = chartLeft + margin.left;
  const innerTop = chartTop + margin.top;

  // 1) Determine min/max for data (y) & time (x)
  const [yMin, yMax] = d3Array.extent(data, (d) => d.value) as [number, number];
  const xDomain = d3Array.extent(data, (d) => d.date) as [Date, Date];

  // 2) Create scales
  const xScale = d3Scale
    .scaleTime()
    .domain(xDomain)
    .range([0, innerWidth]);

  const yScale = d3Scale
    .scaleLinear()
    .domain([yMin, yMax])
    .range([innerHeight, 0])
    .nice();

  // 3) Draw X axis line
  const xAxisY = innerTop + innerHeight;
  doc
    .moveTo(innerLeft, xAxisY)
    .lineTo(innerLeft + innerWidth, xAxisY)
    .strokeColor('black')
    .lineWidth(1)
    .stroke();

  // X-axis ticks (rotated labels)
  const xTicks = xScale.ticks(5);
  const xFormat = d3TimeFormat.timeFormat('%Y-%m-%d');

  xTicks.forEach((tickVal) => {
    const tx = xScale(tickVal);
    const tickX = innerLeft + tx;

    // Short tick mark
    doc
      .moveTo(tickX, xAxisY + 4)
      .lineTo(tickX, xAxisY)
      .stroke();

    // Rotated label
    const label = xFormat(tickVal);

    // We'll rotate the label by -90 degrees around the point (tickX, xAxisY + 5).
    // That point becomes the "origin" for the rotated text.
    doc.save();
    doc.fontSize(7).fillColor('black');

    // 1) Move the origin to (tickX, xAxisY + 5)
    doc.translate(tickX-5, xAxisY + 5);

    // 2) Rotate -90 degrees (clockwise)
    doc.rotate(-90);

    // 3) Place text. Position it so it doesn't overlap the axis line.
    //    For example, we shift it up by ~10 so it stands out.
    //    We'll use a small negative x offset so the text is more visible.
    doc.text(label, -35, 0, {
      width: 40, // some width to contain text
      align: 'left'
    });

    doc.restore();
  });

  // 4) Draw Y axis line
  doc
    .moveTo(innerLeft, innerTop)
    .lineTo(innerLeft, innerTop + innerHeight)
    .strokeColor('black')
    .lineWidth(1)
    .stroke();

  // Y-axis ticks
  const yTicks = yScale.ticks(5);
  const yFormat = d3Format.format('.2f');

  yTicks.forEach((tickVal) => {
    const ty = yScale(tickVal);
    const tickY = innerTop + ty;

    // short tick
    doc
      .moveTo(innerLeft, tickY)
      .lineTo(innerLeft - 5, tickY)
      .stroke();

    // label
    const label = yFormat(tickVal);
    doc.fontSize(8).fillColor('black');
    doc.text(label, innerLeft - 30, tickY - 5, {
      width: 25,
      align: 'right'
    });
  });

  // 5) Plot the line
  doc.save().strokeColor('steelblue').lineWidth(1.5);

  // Sort data by date
  const sorted = [...data].sort((a, b) => a.date.getTime() - b.date.getTime());

  sorted.forEach((d, i) => {
    const px = innerLeft + xScale(d.date);
    const py = innerTop + yScale(d.value);

    if (i === 0) {
      doc.moveTo(px, py);
    } else {
      doc.lineTo(px, py);
    }
  });

  doc.stroke().restore();

  // 6) Advance doc.y so subsequent content is below the chart
  doc.y = chartTop + chartHeight + 20; 
}

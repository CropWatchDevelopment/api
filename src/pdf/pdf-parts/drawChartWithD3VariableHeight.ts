interface DataPoint {
  date: Date;
  value: number;
}

interface ChartOptions {
  /** Maximum width (in points) for the chart. If not specified, fills the available page width. */
  maxWidth?: number;
  /** Maximum height (in points) for the chart. If not specified, fill the remaining page space. */
  maxHeight?: number;
  /** Optional title to display above the chart. */
  title?: string;
  /** Optional color for the line stroke (e.g. 'red', '#ff0000', etc.). */
  lineColor?: string;
}

/**
 * Draws a line chart using D3. 
 * - The chart width is constrained by `options.maxWidth` (or the page width minus margins).
 * - The chart height is constrained by `options.maxHeight` (or the remaining page space).
 * - Y-axis tick labels have enough left margin so they don’t spill outside the chart.
 */
export async function drawChartWithD3VariableHeight(
  doc: PDFKit.PDFDocument,
  data: DataPoint[],
  options?: ChartOptions
) {
  if (!data.length) return;

  // Dynamically import D3 modules
  const d3Scale = await import('d3-scale');
  const d3Array = await import('d3-array');
  const d3TimeFormat = await import('d3-time-format');
  const d3Format = await import('d3-format');

  // Page geometry
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const marginLeft = doc.page.margins.left;
  const marginRight = 10; // Force 10px right margin for the chart
  const marginBottom = doc.page.margins.bottom + 5;

  // If a title was provided, draw it above the chart.
  let chartTop = doc.y;
  if (options?.title) {
    doc
      .fontSize(12)
      .fillColor('black')
      .text(options.title, marginLeft, chartTop, {
        width: pageWidth - marginLeft - marginRight,
        align: 'left',
      });
    // Move doc.y below the title
    doc.moveDown(1);
    // Update chartTop in case doc.y advanced
    chartTop = doc.y;
  }

  // Determine the available width from the left margin → 10px from right edge
  const availableWidth = pageWidth - marginLeft - marginRight;
  // Respect user-supplied maxWidth if any
  const maxWidth = options?.maxWidth ?? availableWidth;
  const chartWidth = Math.min(availableWidth, maxWidth);

  // Maximum available height to bottom margin
  const availableHeight = pageHeight - chartTop - marginBottom;
  const maxHeight = options?.maxHeight ?? availableHeight;
  const chartHeight = Math.min(availableHeight, maxHeight);

  // We add internal chart margins so the tick labels can fit
  // (especially on the left for Y-axis text):
  const internalMargin = {
    top: 20,
    right: 10,
    bottom: 20,
    left: 40,
  };

  // Outer chart bounding box
  const chartLeft = marginLeft;
  // (Optional) faint bounding box (for debugging or illustration)
  doc
    .save()
    .lineWidth(0.5)
    .strokeColor('#cccccc')
    .rect(chartLeft, chartTop, chartWidth, chartHeight)
    .stroke()
    .restore();

  // Inner chart area = chart box minus the internal margins
  const innerWidth = chartWidth - (internalMargin.left + internalMargin.right);
  const innerHeight = chartHeight - (internalMargin.top + internalMargin.bottom);

  // Top-left of the *inner* area where we actually plot axes and data
  const innerLeft = chartLeft + internalMargin.left;
  const innerTop = chartTop + internalMargin.top;

  // 1) Determine min/max for data (y) & time (x)
  const [yMin, yMax] = d3Array.extent(data, (d) => d.value) as [number, number];
  const xDomain = d3Array.extent(data, (d) => d.date) as [Date, Date];

  // 2) Create scales
  const xScale = d3Scale.scaleTime().domain(xDomain).range([0, innerWidth]);
  const yScale = d3Scale.scaleLinear().domain([yMin, yMax]).range([innerHeight, 0]).nice();

  // 3) X-axis line (bottom)
  const xAxisY = innerTop + innerHeight;
  doc
    .moveTo(innerLeft, xAxisY)
    .lineTo(innerLeft + innerWidth, xAxisY)
    .strokeColor('black')
    .lineWidth(1)
    .stroke();

  // X-axis ticks (rotated)
  const xTicks = xScale.ticks(5);
  const xFormat = d3TimeFormat.timeFormat('%Y-%m-%d');

  xTicks.forEach((tickVal) => {
    const tx = xScale(tickVal);
    const tickX = innerLeft + tx;

    // Tick mark
    doc
      .moveTo(tickX, xAxisY + 4)
      .lineTo(tickX, xAxisY)
      .stroke();

    // Rotated label
    const label = xFormat(tickVal);
    doc.save();
    doc.fontSize(7).fillColor('black');
    // Translate to the bottom of the axis, rotate -90, then draw text
    doc.translate(tickX - 5, xAxisY + 5);
    doc.rotate(-90);
    doc.text(label, -35, 0, {
      width: 40,
      align: 'left',
    });
    doc.restore();
  });

  // 4) Y-axis line (left)
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

    // short tick going left from the axis
    doc
      .moveTo(innerLeft, tickY)
      .lineTo(innerLeft - 5, tickY)
      .stroke();

    // label, aligned right, so it doesn't push outside the chart
    const label = yFormat(tickVal);
    doc.fontSize(8).fillColor('black');

    // We place the text to the left of `innerLeft`, but not so far that it leaves the bounding box
    doc.text(label, innerLeft - internalMargin.left, tickY - 5, {
      width: internalMargin.left - 7, // a bit of padding
      align: 'right',
    });
  });

  // 5) Plot the line
  // Use user-supplied line color or default to 'steelblue'
  const lineColor = options?.lineColor ?? 'steelblue';
  doc.save().strokeColor(lineColor).lineWidth(1.5);

  // Sort data by date
  const sorted = [...data].sort((a, b) => a.date.getTime() - b.date.getTime());

  sorted.forEach((d, i) => {
    if (d.value === null) return;
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

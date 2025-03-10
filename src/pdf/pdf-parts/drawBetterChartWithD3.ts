import PDFDocument from 'pdfkit';

interface DataRecord {
  created_at: string;    // e.g., '2024-12-31T15:02:15.743152+00:00'
  temperature_c: number;
}

/**
 * Draws a line chart that spans the full page width (left margin → right margin).
 * The height extends from the current doc.y down toward the bottom margin,
 * with the X-axis tick labels rotated 90 degrees.
 *
 * Expects data of shape:
 *   [
 *     { created_at: '2024-12-31T15:02:15.743152+00:00', temperatureC: -21.8 },
 *     ...
 *   ]
 */
export async function drawSimpleLineChartD3Style(
  doc: PDFKit.PDFDocument,
  data: DataRecord[]
) {
  // 1) Dynamically import only the pieces we need.
  const d3Scale       = await import('d3-scale');
  const d3Array       = await import('d3-array');
  const d3TimeFormat  = await import('d3-time-format');
  const d3Format      = await import('d3-format');

  // 2) Destructure the actual functions from the dynamic imports
  //    for convenience:
  const { scaleTime, scaleLinear } = d3Scale;
  const { extent } = d3Array;
  const { timeFormat } = d3TimeFormat;
  const { format: d3NumberFormat } = d3Format;

  // If no data or empty array, skip
  if (!data || data.length === 0) return;

  // 3) Define chart margins
  const margin = { top: 20, right: 0, bottom: 0, left: 0 };

  // 4) Calculate chart area
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const marginLeft = doc.page.margins.left;
  const marginRight = doc.page.margins.right;
  const marginBottom = doc.page.margins.bottom + 5;

  const chartLeft = marginLeft;
  const chartTop = doc.y; // current vertical position in the document
  const chartWidth = pageWidth - marginLeft - marginRight;
  const availableHeight = pageHeight - chartTop - marginBottom;
  const chartHeight = availableHeight;

  // Optional: Draw a faint bounding box around the chart area
  doc
    .save()
    .lineWidth(0.5)
    .strokeColor('#cccccc')
    .rect(chartLeft, chartTop, chartWidth, chartHeight)
    .stroke()
    .restore();

  // Inner area = chart minus the internal margins
  const innerWidth = chartWidth - (margin.left + margin.right);
  const innerHeight = chartHeight - (margin.top + margin.bottom);

  // Top-left of the inner area
  const innerLeft = chartLeft + margin.left;
  const innerTop = chartTop + margin.top;

  // 5) Determine min/max for temperatureC (y) & time (x)
  //    Use d3-array's extent, but pass in "d => new Date(d.created_at)" for X,
  //    and "d => d.temperatureC" for Y.
  const [yMin, yMax] = extent(data, (d) => d.temperature_c) as [number, number];
  const xDomain = extent(data, (d) => new Date(d.created_at)) as [Date, Date];

  // If yMin or xDomain are undefined, that means invalid data. Early return.
  if (yMin === undefined || yMax === undefined || !xDomain[0] || !xDomain[1]) {
    return;
  }

  // 6) Create scales
  //    - scaleTime for X
  //    - scaleLinear for Y
  const xScale = scaleTime()
    .domain(xDomain)
    .range([0, innerWidth]);

  const yScale = scaleLinear()
    .domain([yMin, yMax])
    .range([innerHeight, 0])
    .nice(); // .nice() for nicer tick rounding

  // 7) Draw X axis line
  const xAxisY = innerTop + innerHeight;
  doc
    .moveTo(innerLeft, xAxisY)
    .lineTo(innerLeft + innerWidth, xAxisY)
    .strokeColor('black')
    .lineWidth(1)
    .stroke();

  // 7a) X-axis ticks (rotated labels)
  //     We can let d3 generate a few ticks.
  const xTicks = xScale.ticks(5);
  const xFormat = timeFormat('%Y-%m-%d');

  xTicks.forEach((tickVal) => {
    const tx = xScale(tickVal); // this returns a number
    const tickX = innerLeft + tx;

    // Short tick mark
    doc
      .moveTo(tickX, xAxisY)
      .lineTo(tickX, xAxisY + 4)
      .stroke();

    // Rotated label
    const label = xFormat(tickVal);

    // We'll rotate the label by -90 degrees around the point (tickX, xAxisY + 5).
    doc.save();
    doc.fontSize(7).fillColor('black');

    // 1) Move the origin to (tickX, xAxisY + 5)
    doc.translate(tickX - 5, xAxisY + 5);

    // 2) Rotate -90 degrees (clockwise)
    doc.rotate(-90);

    // 3) Place text
    doc.text(label, -35, 0, {
      width: 40, // width to contain text
      align: 'left'
    });

    doc.restore();
  });

  // 8) Draw Y axis line
  doc
    .moveTo(innerLeft, innerTop)
    .lineTo(innerLeft, innerTop + innerHeight)
    .strokeColor('black')
    .lineWidth(1)
    .stroke();

  // 8a) Y-axis ticks
  const yTicks = yScale.ticks(5);
  // Format numbers with .2f
  const yFormatter = d3NumberFormat('.2f');

  yTicks.forEach((tickVal) => {
    const ty = yScale(tickVal);
    const tickY = innerTop + ty;

    // Short tick on Y
    doc
      .moveTo(innerLeft, tickY)
      .lineTo(innerLeft - 5, tickY)
      .stroke();

    // Y-axis label
    const label = yFormatter(tickVal);
    doc.fontSize(8).fillColor('black');
    doc.text(label, innerLeft - 30, tickY - 5, {
      width: 25,
      align: 'right'
    });
  });

  // 9) Plot the line
  doc.save().strokeColor('steelblue').lineWidth(1.5);

  // Sort data by date to draw the line in chronological order
  const sorted = [...data].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  sorted.forEach((d, i) => {
    if (d.temperature_c === null) return;
    const px = innerLeft + xScale(new Date(d.created_at));
    const py = innerTop + yScale(d.temperature_c);

    if (i === 0) {
      doc.moveTo(px, py);
    } else {
      doc.lineTo(px, py);
    }
  });

  doc.stroke().restore();

  // 10) Advance doc.y so subsequent content is below the chart
  doc.y = chartTop + chartHeight + 20;
}

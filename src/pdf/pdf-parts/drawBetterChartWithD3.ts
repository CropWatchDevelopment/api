// For consistency with your CSV code snippet
interface DataPoint {
  date: Date;
  value: number;
}

/**
 * Draws a line chart that spans the full page width (left margin → right margin).
 * The height extends from the current doc.y down toward the bottom margin.
 */
export async function drawSimpleLineChartD3Style(
  doc: PDFKit.PDFDocument,
  data: DataPoint[]
) {
  // 0) If no data, skip drawing
  if (!data.length) return;

  // Dynamically import D3 modules (because you're in CommonJS + ESM environment)
  const d3Scale = await import('d3-scale');
  const d3Array = await import('d3-array');
  const d3TimeFormat = await import('d3-time-format');
  const d3Format = await import('d3-format');

  // Example margins (inset inside the chart)
  // so you have space for axes labels and ticks
  const margin = { top: 20, right: 30, bottom: 40, left: 60 };

  // 1) Calculate the outer width/height for the chart bounding box
  //    - Full width from left margin to right margin
  //    - Height from current doc.y down to bottom margin
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const marginLeft = doc.page.margins.left;
  const marginRight = doc.page.margins.right;
  const marginBottom = doc.page.margins.bottom;

  const chartLeft = marginLeft;   // start at the left margin
  const chartTop = doc.y;         // start at current doc.y
  const chartWidth = pageWidth - marginLeft - marginRight;

  // If you want the chart to fill down to the bottom margin:
  const availableHeight = pageHeight - chartTop - marginBottom;
  // Or pick a fixed height, e.g. const availableHeight = 400;

  // We'll just use availableHeight
  const chartHeight = availableHeight;

  // 2) Draw a faint bounding box for the entire chart region
  doc
    .save()
    .lineWidth(0.5)
    .strokeColor('#cccccc')
    .rect(chartLeft, chartTop, chartWidth, chartHeight)
    .stroke()
    .restore();

  // 3) Now define the "inner" area (like in your D3 snippet)
  //    This is the chart area minus the top/right/bottom/left margins
  const innerWidth = chartWidth - (margin.left + margin.right);
  const innerHeight = chartHeight - (margin.top + margin.bottom);

  // We'll define the top-left corner of the *inner* area
  const innerLeft = chartLeft + margin.left;
  const innerTop = chartTop + margin.top;

  // 4) Setup D3 scales
  //    domain for x = [minDate, maxDate]
  // For y, we can do from 0 to max
  const [yMin, yMax] = d3Array.extent(data, (d) => d.value) as [number, number];
  const xDomain = d3Array.extent(data, (d) => d.date) as [Date, Date];

  const xScale = d3Scale
  .scaleTime()
  .domain(xDomain)
  .range([0, innerWidth]);

  const yScale = d3Scale
  .scaleLinear()
  .domain([yMin, yMax])
  .range([innerHeight, 0])
  .nice(); // "nice" is optional

  // 5) Draw the X axis line
  // The bottom of the inner chart is innerTop + innerHeight
  const xAxisY = innerTop + innerHeight;
  doc
    .moveTo(innerLeft, xAxisY)
    .lineTo(innerLeft + innerWidth, xAxisY)
    .strokeColor('black')
    .lineWidth(1)
    .stroke();

  // X-axis ticks
  const xTicks = xScale.ticks(5); // or 6, your choice
  const xFormat = d3TimeFormat.timeFormat('%Y-%m-%d');

  xTicks.forEach((tickVal) => {
    const tx = xScale(tickVal);
    const tickX = innerLeft + tx;

    // Short tick mark
    doc
      .moveTo(tickX, xAxisY)
      .lineTo(tickX, xAxisY + 5)
      .stroke();

    // Label
    const label = xFormat(tickVal);
    doc.fontSize(8).fillColor('black');
    doc.text(label, tickX - 20, xAxisY + 7, {
      width: 40,
      align: 'center'
    });
  });

  // 6) Draw the Y axis line
  // The left of the inner chart is innerLeft
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

  // 7) Plot the line
  doc.save();
  doc.strokeColor('steelblue').lineWidth(1.5);

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

  // 8) Advance doc.y so subsequent content is below the chart
  doc.y = chartTop + chartHeight + 20; 
  // or doc.y = doc.y + chartHeight + 20; if you want to stack multiple charts
}

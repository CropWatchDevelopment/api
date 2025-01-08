import * as d3Scale from 'd3-scale';
import * as d3Array from 'd3-array';
import * as d3TimeFormat from 'd3-time-format';

interface DataPoint {
  date: Date;
  value: number;
}

/**
 * Draws a D3-based chart (with axis lines, ticks, labels, data)
 * spanning the full page width and extending down to bottom margin.
 */
export function drawGraphWithD3(
  doc: PDFKit.PDFDocument,
  dataPoints: DataPoint[]
) {
  if (!dataPoints.length) return;

  // 1) Compute the chart area
  const marginLeft = doc.page.margins.left;
  const marginRight = doc.page.margins.right;
  const marginBottom = doc.page.margins.bottom;

  const chartWidth = doc.page.width - marginLeft - marginRight;
  const chartHeight = doc.page.height - marginBottom - doc.y; 
    // from current doc.y to bottom margin

  // For a small padding around the axes inside the chart:
  const padding = 40; 
  const innerWidth = chartWidth - padding * 2;
  const innerHeight = chartHeight - padding * 2;

  const chartOriginX = marginLeft;
  const chartOriginY = doc.y;

  // 2) Determine min/max for time (x) and value (y)
  const timeExtent = d3Array.extent(dataPoints, (d) => d.date) as [Date, Date];
  const valueExtent = d3Array.extent(dataPoints, (d) => d.value) as [number, number];

  // If we have no valid extent, bail
  if (!timeExtent[0] || !timeExtent[1] || valueExtent[0] == null || valueExtent[1] == null) {
    return;
  }

  // 3) Create scales (x = time, y = linear)
  const xScale = d3Scale
    .scaleTime()
    .domain(timeExtent)
    .range([chartOriginX + padding, chartOriginX + padding + innerWidth]);

  const yScale = d3Scale
    .scaleLinear()
    .domain(valueExtent)
    .range([chartOriginY + padding + innerHeight, chartOriginY + padding]); 
    // note: invert for top-down coordinate system

  // 4) Draw bounding box for reference (optional)
  doc.save();
  doc
    .rect(chartOriginX, chartOriginY, chartWidth, chartHeight)
    .stroke();
  doc.restore();

  // 5) Draw axes
  //    We do NOT have an actual DOM, so we manually get ticks from the scales.

  // 5a) X-axis: horizontal along bottom of chart
  const xTicks = xScale.ticks(5); // pick your number of ticks
  // We can format times with d3-time-format
  const xFormat = d3TimeFormat.timeFormat('%m/%d %H:%M'); // e.g. "04/19 02:00"

  // The Y coordinate for the X-axis line is the bottom of chart (yScale range min)
  const xAxisY = yScale.range()[0]; 

  // Draw X axis line
  doc
    .moveTo(xScale.range()[0], xAxisY)  // left end
    .lineTo(xScale.range()[1], xAxisY)  // right end
    .stroke();

  // For each tick, draw a short tick mark and label
  xTicks.forEach((tickVal) => {
    const x = xScale(tickVal);
    // Tick mark
    doc
      .moveTo(x, xAxisY)
      .lineTo(x, xAxisY + 5) // 5px downward
      .stroke();

    // Tick label
    const label = xFormat(tickVal);
    // We'll shift label ~10px below the axis
    doc.fontSize(8).text(label, x - 15, xAxisY + 7, { width: 30, align: 'center' });
  });

  // 5b) Y-axis: vertical along left side
  const yTicks = yScale.ticks(5); 
  // Or use d3.ticks(min, max, count) if you want more control
  // e.g. d3Array.ticks(valueExtent[0], valueExtent[1], 5)

  // The X coordinate for the Y-axis line is the left side (xScale range min)
  const yAxisX = xScale.range()[0];

  // Draw Y axis line
  doc
    .moveTo(yAxisX, yScale.range()[1]) // top
    .lineTo(yAxisX, yScale.range()[0]) // bottom
    .stroke();

  // For each y tick
  yTicks.forEach((tickVal) => {
    const y = yScale(tickVal);
    // Tick mark
    doc
      .moveTo(yAxisX, y)
      .lineTo(yAxisX - 5, y) // 5px to the left
      .stroke();

    // Tick label
    const label = String(tickVal.toFixed(2)); // or d3Format.format('.2f')
    // Place ~ 20px to left of axis
    const labelWidth = 30;
    doc.fontSize(8).text(label, yAxisX - labelWidth - 5, y - 5, {
      width: labelWidth,
      align: 'right'
    });
  });

  // 6) Draw the data line
  doc.save().strokeColor('blue').lineWidth(1);

  dataPoints.forEach((dp, i) => {
    const x = xScale(dp.date);
    const y = yScale(dp.value);

    if (i === 0) {
      doc.moveTo(x, y);
    } else {
      doc.lineTo(x, y);
    }
  });

  doc.stroke().restore();

  // (Optional) You could also add circles at each data point
  doc.save().fillColor('blue');
  dataPoints.forEach((dp) => {
    const x = xScale(dp.date);
    const y = yScale(dp.value);
    doc.circle(x, y, 2).fill();
  });
  doc.restore();

  // 7) Advance doc.y so future content is below this chart
  doc.y = chartOriginY + chartHeight + 20; 
}

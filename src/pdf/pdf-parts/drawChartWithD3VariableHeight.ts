interface DataPoint {
    date: Date;
    value: number;
  }
  
  interface ChartOptions {
    /** Maximum height (in points) for the chart. If not specified, fill the remaining page space. */
    maxHeight?: number;
    /** Optional title to display above the chart. */
    title?: string;
    /** Optional color for the line stroke (e.g. 'red', '#ff0000', etc.). */
    lineColor?: string;
  }
  
  /**
   * Draws a line chart that spans the full page width (left margin → 10px from right edge).
   * The height is limited by either `options.maxHeight` or the remaining space to the bottom margin.
   * X-axis tick labels are rotated 90 degrees.
   * If `options.title` is provided, it's rendered above the chart.
   * If `options.lineColor` is provided, the line stroke uses that color; otherwise uses 'steelblue'.
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
  
    // Minimal internal chart margin
    const margin = { top: 20, right: 0, bottom: 0, left: 0 };
  
    // Page geometry
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const marginLeft = doc.page.margins.left;
    const marginRight = 10;               // Force 10px right margin for the chart
    const marginBottom = doc.page.margins.bottom + 5;
  
    // Start X and Y for the chart area
    let chartLeft = marginLeft;
    let chartTop = doc.y;
  
    // If a title was provided, draw it above the chart.
    if (options?.title) {
      doc.fontSize(12).fillColor('black').text(options.title, chartLeft, chartTop, {
        width: pageWidth - marginLeft - marginRight,
        align: 'left',
      });
      // Move doc.y below the title
      doc.moveDown(1);
      // Update chartTop in case doc.y advanced
      chartTop = doc.y;
    }
  
    // Chart bounding box
    const chartWidth = pageWidth - marginLeft - marginRight;
  
    // Maximum available height to bottom margin
    const availableHeight = pageHeight - chartTop - marginBottom;
  
    // Respect user-supplied maxHeight if any
    const maxHeight = options?.maxHeight ?? availableHeight;
    const chartHeight = Math.min(availableHeight, maxHeight);
  
    // (Optional) faint bounding box
    doc
      .save()
      .lineWidth(0.5)
      .strokeColor('#cccccc')
      .rect(chartLeft, chartTop, chartWidth, chartHeight)
      .stroke()
      .restore();
  
    // Inner chart area = chart box minus local margin
    const innerWidth = chartWidth - (margin.left + margin.right);
    const innerHeight = chartHeight - (margin.top + margin.bottom);
  
    // Top-left of the inner area
    const innerLeft = chartLeft + margin.left;
    const innerTop = chartTop + margin.top;
  
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
      doc.translate(tickX - 5, xAxisY + 5);
      doc.rotate(-90);
      doc.text(label, -35, 0, {
        width: 40,
        align: 'left'
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
  
      // short tick
      doc
        .moveTo(innerLeft, tickY)
        .lineTo(innerLeft - 5, tickY)
        .stroke();
  
      // label
      const label = yFormat(tickVal);
      doc.fontSize(8).fillColor('black');
      doc.text(label, innerLeft - 40, tickY - 5, {
        width: 40,
        align: 'left'
      });
    });
  
    // 5) Plot the line
    // Use user-supplied line color or default to 'steelblue'
    const lineColor = options?.lineColor ?? 'steelblue';
    doc.save().strokeColor(lineColor).lineWidth(1.5);
  
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
  
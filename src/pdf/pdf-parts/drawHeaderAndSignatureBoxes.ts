import { TableColorRange } from '../interfaces/TableColorRange';
import { drawSignatureBoxes } from './drawSignatureBoxes';

/**
 * Draws the "Report Summary" text for company/department/location/sensor (unchanged),
 * then draws a table (50% width, no vertical borders, horizontal lines only),
 * then the signature boxes on the right.
 */
export function drawHeaderAndSignatureBoxes(
  doc: PDFKit.PDFDocument,
  data: any[],
  tableColorRange: TableColorRange[],
  reportUserData,
) {

  const { company, department, location, deviceName, dev_eui, timeSpan } = reportUserData;


  // 1) Save the starting position
  const startX = doc.x;
  const startY = doc.y;

  // We'll compute how wide the main content area is (page minus left/right margins)
  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // The left portion is 60% for the top text, but for the "stats table" we only want 50% width
  // so let's define some partial widths:
  const headerTableWidth = availableWidth * 0.6;   // for the "Report Summary"
  const statsTableWidth = availableWidth * 0.5;    // for the horizontal-line table

  // -------------------------------------------------------------------------
  // 2) Draw the "Report Summary" (left side) -- same as before
  // -------------------------------------------------------------------------
  doc.save();

  doc.fontSize(14).text('Report Summary', startX, startY, { width: headerTableWidth });
  doc.moveDown(1);

  doc.fontSize(10);
  doc.text(`会社: ${company}`, { width: headerTableWidth });
  if (department) {
    doc.text(`部署: ${department}`, { width: headerTableWidth });
  }
  doc.text(`使用場所: ${location}`, { width: headerTableWidth });
  doc.text(`センサー名: ${deviceName}`, { width: headerTableWidth });
  doc.text(`DevEUI: ${dev_eui}`, { width: headerTableWidth });

  // We'll stop here—no more "Normal / Notice / Warning / Alert" lines
  // because we want them in the table now.
  //
  // Keep track of how far down we've gone
  const summaryBottomY = doc.y;

  doc.restore();

  // -------------------------------------------------------------------------
  // 3) Draw the signature boxes on the RIGHT, aligned with the top= startY
  // -------------------------------------------------------------------------
  doc.save();
  doc.y = startY;
  drawSignatureBoxes(doc);
  // That function places itself on the far right and moves doc.y below the boxes.
  doc.restore();

  // We see how far the signature boxes extended
  const sigBoxesBottomY = doc.y;

  // The top region's bottom is whichever is greater
  const topBottom = sigBoxesBottomY; //Math.max(summaryBottomY, sigBoxesBottomY);
  doc.y = topBottom; // small gap

  // -------------------------------------------------------------------------
  // 4) Draw the "stats" table at 50% page width (on the LEFT). No vertical lines.
  //    Each row has a bottom horizontal border except the last one.
  // -------------------------------------------------------------------------
  doc.save();

  const statsRows = calculateStatsRows(
    data,
    tableColorRange
  );

  // We'll define a row height
  const rowHeight = 18;
  const tableLeft = doc.page.margins.left - 5;   // current x
  const tableTop = doc.y;    // current y
  let currentY = tableTop;

  // For each row, we place the text, then draw a horizontal line below (except last row).
  statsRows.forEach((rowText, i) => {
    // Place the text
    if (i === 0) {
      doc.fontSize(14).text('コメント:', (doc.page.width / 2) + 25, doc.y, { width: 100 });
    }
    doc.fontSize(10)
      .text(rowText, tableLeft + 5, currentY + 3, {
        width: statsTableWidth - 10,
        ellipsis: true
      });

    // If NOT the last row, draw a horizontal line across
    if (i < statsRows.length - 1) {
      doc
        .moveTo(tableLeft, currentY + rowHeight) // start
        .lineTo(tableLeft + statsTableWidth, currentY + rowHeight) // end
        .lineWidth(1)
        .strokeColor('black')
        .stroke();
    }
    // Move down
    currentY += rowHeight;
  });

  // The bottom of the table
  const statsTableBottomY = currentY;
  doc.restore();

  // -------------------------------------------------------------------------
  // 5) Move doc.y below the table if it's taller than the signature or summary
  // -------------------------------------------------------------------------
  const finalBottom = Math.max(statsTableBottomY, doc.y);
  doc.y = finalBottom + 20; // extra space
}



/**
 * Calculate stats (sampling count, date range, normal/notice/warning/alert counts & percentages,
 * min, max, avg, standard deviation) and build statsRows array of strings for logging or display.
 */
function calculateStatsRows(data, tableColorRange) {
  if (!data || data.length === 0) {
    // If no data, return an array of strings indicating no data
    return ['サンプリング数: 0', '測定期間: -', 'No data available'];
  }

  // 1) Sort by created_at ascending
  const sorted = [...data].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // 2) Total number of datapoints
  const totalDatapoints = sorted.length;

  // 3) Date range: from first to last data point
  const firstData = new Date(sorted[0].created_at);
  const lastData = new Date(sorted[sorted.length - 1].created_at);
  const dateRange = `${formatDateForRange(firstData)} - ${formatDateForRange(lastData)}`;

  // 4) Define proper ranges.
  // Notice: the Normal range should capture temperatures ≤ -18 (down to -1000 for extreme cases)
  const ranges = {
    Alert:   { min: 0,      max: 9999 },
    Warning: { min: -15.1,  max: 0 },
    Notice:  { min: -17.99, max: -15.1 },
    Normal:  { min: -1000,  max: -18 }  // Lower bound is -1000, upper bound is -18
  };

  // Initialize counts for each category
  const classificationCounts = { Normal: 0, Notice: 0, Warning: 0, Alert: 0 };

  // 5) Classify each temperature reading
  for (const rec of sorted) {
    const t = rec.temperature_c;
    // Check Alert first: temperatures >= 0
    if (t >= ranges.Alert.min && t <= ranges.Alert.max) {
      classificationCounts.Alert++;
    } 
    // Warning: -15.1 <= t < 0
    else if (t >= ranges.Warning.min && t < ranges.Warning.max) {
      classificationCounts.Warning++;
    } 
    // Notice: -17.99 <= t < -15.1
    else if (t >= ranges.Notice.min && t < ranges.Warning.min) {
      classificationCounts.Notice++;
    } 
    // Normal: -1000 <= t <= -18
    else if (t >= ranges.Normal.min && t <= ranges.Normal.max) {
      classificationCounts.Normal++;
    }
    // If a reading falls outside the defined ranges, you may choose to ignore it
  }

  // 6) Calculate percentages
  const normalPercentage = (classificationCounts.Normal / totalDatapoints) * 100;
  const noticePercentage = (classificationCounts.Notice / totalDatapoints) * 100;
  const warningPercentage = (classificationCounts.Warning / totalDatapoints) * 100;
  const alertPercentage = (classificationCounts.Alert / totalDatapoints) * 100;

  // 7) Compute statistical values: min, max, avg, stddev
  const temperatures = sorted.map(item => item.temperature_c);
  const min = Math.min(...temperatures);
  const max = Math.max(...temperatures);
  const avg = average(temperatures);
  const stdDiv = stddev(temperatures);

  // 8) Build the final statsRows array as strings
  const statsRows = [
    `サンプリング数: ${totalDatapoints}`,
    `測定期間: ${dateRange}`,
    `Normal: ${classificationCounts.Normal} (${normalPercentage.toFixed(2)}%)`,
    `Notice: ${classificationCounts.Notice} (${noticePercentage.toFixed(2)}%)`,
    `Warning: ${classificationCounts.Warning} (${warningPercentage.toFixed(2)}%)`,
    `Alert: ${classificationCounts.Alert} (${alertPercentage.toFixed(2)}%)`,
    `最大値: ${max}`,
    `最小値: ${min}`,
    `平均値: ${avg.toFixed(2)}`,
    `標準偏差: ${stdDiv.toFixed(2)}`
  ];

  return statsRows;
}

// --------------------
// Helper Functions
// --------------------

/**
 * Format a Date as "YYYY-MM-DD HH:mm"
 */
function formatDateForRange(date) {
  const yyyy = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
}

/**
 * Compute average of an array of numbers
 */
function average(nums) {
  if (!nums || nums.length === 0) return 0;
  const sum = nums.reduce((acc, val) => acc + val, 0);
  return sum / nums.length;
}

/**
 * Compute population standard deviation
 */
function stddev(nums) {
  if (nums.length < 2) return 0;
  const avgVal = average(nums);
  const variance = nums.reduce((acc, val) => acc + Math.pow(val - avgVal, 2), 0) / nums.length;
  return Math.sqrt(variance);
}

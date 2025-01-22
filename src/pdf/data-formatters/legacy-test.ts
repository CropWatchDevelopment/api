import { pdfReportFormat } from "../interfaces/report.interface";

// 3) The main transform function
export function mapToPdfReport(
  raw: any[],   // typed as RawRecord[]
  // Hardcode or pass these in as parameters
  company: string,
  department: string | undefined,
  usageLocation: string,
  sensorName: string,
  devEui: string,
): pdfReportFormat {
  // If empty or null, return a structure with "no data"
  if (!raw || raw.length === 0) {
    const now = new Date();
    return {
      company,
      department,
      useageLocation: usageLocation,
      sensorName,
      devEui,

      firstData: now,
      lastData: now,
      dateRange: 'No data',

      totalDatapoints: 0,
      normal: 0,
      normalPercentage: 0,
      notice: 0,
      noticePercentage: 0,
      warning: 0,
      warningPercentage: 0,
      alert: 0,
      alertPercentage: 0,

      max: 0,
      min: 0,
      avg: 0,
      stdDiv: 0,

      dataPoints: [],
    };
  }

  // Sort by created_at ascending
  const sorted = [...raw].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // firstData, lastData, dateRange
  const firstData = new Date(sorted[0].created_at);
  const lastData = new Date(sorted[sorted.length - 1].created_at);
  const dateRange = `${formatDateForRange(firstData)} - ${formatDateForRange(lastData)}`;

  // totalDatapoints
  const totalDatapoints = sorted.length;

  // ------------------------------------------------------------------
  // Example classification logic for 'normal', 'notice', 'warning', 'alert'
  // Adjust to match your own severity thresholds or fields.
  //
  // In this example:
  //   - ALERT if temp < -30 or temp > 30
  //   - WARNING if -30 <= temp < -15 or 25 < temp <= 30
  //   - NOTICE if -15 <= temp < 0 or 20 < temp <= 25
  //   - NORMAL otherwise (0 <= temp <= 20)
  // ------------------------------------------------------------------
  let normalCount = 0;
  let noticeCount = 0;
  let warningCount = 0;
  let alertCount = 0;

  sorted.forEach(r => {
    const t = r.temperatureC;

    if (t < -30 || t > 30) {
      alertCount++;
    } else if ((t >= -30 && t < -15) || (t > 25 && t <= 30)) {
      warningCount++;
    } else if ((t >= -15 && t < 0) || (t > 20 && t <= 25)) {
      noticeCount++;
    } else {
      normalCount++;
    }
  });

  // Calculate percentages
  const normalPercentage = (normalCount / totalDatapoints) * 100;
  const noticePercentage = (noticeCount / totalDatapoints) * 100;
  const warningPercentage = (warningCount / totalDatapoints) * 100;
  const alertPercentage = (alertCount / totalDatapoints) * 100;

  // min, max, avg, stdDiv of temperatureC
  const temperatures = sorted.map((r) => r.temperatureC);

  const min = Math.min(...temperatures);
  const max = Math.max(...temperatures);
  const avg = average(temperatures);
  const stdDiv = stddev(temperatures);

  // Map dataPoints
  const dataPoints = sorted.map((r) => ({
    date: new Date(r.created_at),
    value: r.temperatureC,
    comment: `DewPt: ${r.dewPointC}, RH: ${r.humidity}%` 
  }));

  // Return the fully populated structure
  return {
    company,
    department,
    useageLocation: usageLocation,
    sensorName,
    devEui,

    firstData,
    lastData,
    dateRange,

    totalDatapoints,
    normal: normalCount,
    normalPercentage,
    notice: noticeCount,
    noticePercentage,
    warning: warningCount,
    warningPercentage,
    alert: alertCount,
    alertPercentage,

    max,
    min,
    avg,
    stdDiv,

    dataPoints
  };
}

// --------------------
// Helper Functions
// --------------------

/**
 * Format Date for the dateRange string
 * Example: '2024-04-19 04:16'
 */
function formatDateForRange(date: Date): string {
  // Adjust as needed for your desired format/timezone
  const yyyy = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
}

/**
 * Compute average
 */
function average(nums: number[]): number {
  if (!nums.length) return 0;
  const sum = nums.reduce((acc, val) => acc + val, 0);
  return sum / nums.length;
}

/**
 * Compute standard deviation (population-based).
 * If you want sample-based, use (nums.length - 1) in the denominator.
 */
function stddev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const avgVal = average(nums);
  const variance =
    nums.reduce((acc, val) => acc + Math.pow(val - avgVal, 2), 0) / nums.length;
  return Math.sqrt(variance);
}
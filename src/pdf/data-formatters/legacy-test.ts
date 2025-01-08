import { pdfReportFormat } from "../interfaces/report.interface";

// 1) Adjust this interface to reflect your actual raw data shape if needed
interface RawRecord {
    id: number;
    created_at: string;   // e.g., '2024-04-19T04:16:03.151832+00:00'
    dewPointC: number;
    humidity: number;
    temperatureC: number;
    vpd: number;
    dev_eui: string;
    profile_id: string;
  }
  
  // 2) If you want to pass additional meta info (company, usageLocation, etc.)
  interface RawReportData {
    reportData: RawRecord[];
  }
  
  // 3) The main transform function
  export function mapToPdfReport(
    raw: RawReportData,
    // Hardcode or pass these in as parameters
    company: string,
    department: string | undefined,
    usageLocation: string,
    sensorName: string
  ): pdfReportFormat {
    // Extract the array
    const records = raw.reportData;
    if (!records || records.length === 0) {
      // Return an "empty" structure if no data
      const now = new Date();
      return {
        company,
        department,
        useageLocation: usageLocation,
        sensorName,
  
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
  
        dataPoints: []
      };
    }
  
    // Sort by created_at ascending
    const sorted = [...records].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  
    // firstData, lastData, dateRange
    const firstData = new Date(sorted[0].created_at);
    const lastData = new Date(sorted[sorted.length - 1].created_at);
    const dateRange = `${formatDateForRange(firstData)} - ${formatDateForRange(lastData)}`;
  
    // totalDatapoints
    const totalDatapoints = sorted.length;
  
    // For demonstration, we’ll set these severity counts to 0
    // (because we don’t have severity fields in the raw data)
    const normal = 0;
    const notice = 0;
    const warning = 0;
    const alert = 0;
  
    // likewise percentages:
    const normalPercentage = 0;
    const noticePercentage = 0;
    const warningPercentage = 0;
    const alertPercentage = 0;
  
    // We’ll use temperatureC for min, max, avg, stdDiv. 
    // If you want dewPointC or humidity, just substitute accordingly.
    const temperatures = sorted.map((r) => r.temperatureC);
  
    const min = Math.min(...temperatures);
    const max = Math.max(...temperatures);
    const avg = average(temperatures);
    const stdDiv = stddev(temperatures); // population-based or sample-based, see function below
  
    // Map dataPoints
    // For comment, we’ll leave it empty or add any extra info you want
    const dataPoints = sorted.map((r) => ({
      date: new Date(r.created_at),
      value: r.temperatureC,
      comment: '' // or something like: `DewPt: ${r.dewPointC}, Humidity: ${r.humidity}`
    }));
  
    return {
      company,
      department,
      useageLocation: usageLocation,
      sensorName,
  
      firstData,
      lastData,
      dateRange,
  
      totalDatapoints,
      normal,
      normalPercentage,
      notice,
      noticePercentage,
      warning,
      warningPercentage,
      alert,
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
    // Adjust as needed for your desired format or timezone
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
  
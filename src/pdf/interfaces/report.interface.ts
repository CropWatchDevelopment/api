export interface pdfReportFormat {
    company: string;
    department?: string;
    useageLocation: string;
    sensorName: string;
    devEui: string;
  
    firstData: Date;
    lastData: Date;
    dateRange: string;
  
    totalDatapoints: number;
    normal: number;
    normalPercentage: number;
  
    notice: number;
    noticePercentage: number;
  
    warning: number;
    warningPercentage: number;
  
    alert: number;
    alertPercentage: number;
  
    max: number;
    min: number;
    avg: number;
    stdDiv: number;
  
    dataPoints: {
      date: Date;
      value: number;
      comment?: string;
    }[];
  }
export interface TableColorRange {
    name: string;   // e.g., 'alert', 'warning', etc.
    min: number;    // minimum threshold (inclusive)
    max: number;    // maximum threshold (inclusive)
    color: string;  // the fill color (e.g. 'red', '#FFAAAA', 'orange', etc.)
  }
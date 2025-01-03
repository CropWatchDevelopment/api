// generate-chart-image.ts
import { createCanvas } from 'canvas';
import d3 from 'd3';

/**
 * Generate a chart as a base64 data URL.
 * Using node-canvas so it can run in a Node environment (no DOM).
 */
export async function generateChartImage(chartData: { date: string; value: number }[]): Promise<string> {
    const width = 800;
    const height = 600;

    // Create a "virtual" canvas using node-canvas
    const canvas = createCanvas(width, height);
    const ctx: any = canvas.getContext('2d');

    // We'll use D3 for scales/line generation in an offscreen manner
    const margin = { top: 40, right: 80, bottom: 80, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Convert strings to Date objects
    const parsedData = chartData.map(d => {
        return { date: new Date(d.date), value: d.value };
    });

    // Setup scales
    const x = d3.scaleTime()
        .range([0, innerWidth])
        .domain(d3.extent(parsedData, d => d.date) as [Date, Date]);

    const y = d3.scaleLinear()
        .range([innerHeight, 0])
        .domain([
            d3.min(parsedData, d => d.value)! - 5,
            d3.max(parsedData, d => d.value)! + 5
        ]);

    // Generate line
    const lineGenerator = d3.line<{ date: Date; value: number }>()
        .x(d => x(d.date))
        .y(d => y(d.value));

    // Convert the line path to a string
    const linePath = lineGenerator(parsedData);

    // We'll just do a simple drawing:
    // 1) White background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);

    // 2) Draw axes (very minimal)
    //    For advanced usage, you might manually render tick marks, etc.

    // 3) Draw the line
    if (linePath) {
        // Use a small helper from d3 to "parse" the path commands
        drawPath(ctx, linePath, margin.left, margin.top);
    }

    // ... etc. (Add text labels, ticks, etc., or you can do more sophisticated D3 node-canvas usage.)

    // Return as a base64 data URL
    return canvas.toDataURL('image/png');
}

/**
 * A helper to draw an SVG path string onto a Canvas 2D context at offset (offsetX, offsetY).
 */
function drawPath(ctx: CanvasRenderingContext2D, svgPath: string, offsetX: number, offsetY: number) {
    const path = new Path2D(svgPath);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.strokeStyle = 'steelblue';
    ctx.lineWidth = 2;
    ctx.stroke(path);
    ctx.restore();
}

export function prepareRows(data: any[]): any[][] {
    // Suppose we want to transform or filter data
    return data.map(item => [
        item.id,
        item.created_at,
        item.dewPointC,
        item.humidity,
        item.temperatureC,
        item.vpd,
        item.dev_eui,
        item.profile_id
    ]);
}
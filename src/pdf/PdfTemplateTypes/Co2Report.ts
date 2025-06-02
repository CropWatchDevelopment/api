import PDFDocument from 'pdfkit';
import { drawFourDataGroups } from '../pdf-parts/drawFourDataGroups';
import { drawChartWithD3VariableHeight } from '../pdf-parts/drawChartWithD3VariableHeight';
import { drawDynamicDataTable2, TableHeader } from '../pdf-parts/drawDynamicTable2';
import moment from 'moment';

// PARTS:

export async function buildCO2Report(
    reportData,
    devEui: string = 'n/a',
    companyName: string = 'n/a',
    department: string = 'n/a',
    usageLocation: string = 'n/a',
    sensorName: string = 'n/a',
    startToEndString: string = 'n/a'
): Promise<Buffer> {
    return new Promise<Buffer>(async (resolve, reject) => {
        try {
            // Create a new PDF document
            const doc = new PDFDocument({
                size: 'A4', // 595.28 x 841.89 (approx)
                margin: 40
            });

            doc.registerFont('NotoSansJP', '../../assets/fonts/Noto_Sans_JP/static/NotoSansJP-Regular.ttf');
            doc.font('NotoSansJP');

            doc.x = doc.page.margins.left;
            doc.fontSize(14).text('CO2 レポート', 0, 0, { width: doc.page.width, align: 'center' });
            doc.x = doc.page.margins.left;

            // Collect chunks in memory
            const buffers: Buffer[] = [];
            doc.on('data', (chunk) => buffers.push(chunk));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            // ----------------------------------------------------------------
            // 1) Calculate stats for Temperature, Humidity, and CO2
            // ----------------------------------------------------------------
            // Safeguard: Ensure we have data
            if (!reportData || reportData.length === 0) {
              // If there's no data, finalize an empty PDF or handle it differently
              doc.end();
              return;
            }

            const temperatureValues = reportData.map(d => d.temperature_c);
            const humidityValues = reportData.map(d => d.humidity);
            const co2Values = reportData.map(d => d.co2);

            // Helper functions
            const calcCount = (arr) => arr.length;
            const calcMax = (arr) => Math.max(...arr);
            const calcMin = (arr) => Math.min(...arr);
            const calcAvg = (arr) => {
              if (arr.length === 0) return 0;
              return arr.reduce((sum, val) => sum + val, 0) / arr.length;
            };
            const formatNumber = (num, decimals = 1) => num.toFixed(decimals);

            // Temperature stats
            const tempCount = calcCount(temperatureValues);
            const tempMax = calcMax(temperatureValues);
            const tempMin = calcMin(temperatureValues);
            const tempAvg = calcAvg(temperatureValues);

            // Humidity stats
            const humCount = calcCount(humidityValues);
            const humMax = calcMax(humidityValues);
            const humMin = calcMin(humidityValues);
            const humAvg = calcAvg(humidityValues);

            // CO2 stats
            const co2Count = calcCount(co2Values);
            const co2Max = calcMax(co2Values);
            const co2Min = calcMin(co2Values);
            const co2Avg = calcAvg(co2Values);

            // ----------------------------------------------------------------
            // 2) Build the data groups object
            // ----------------------------------------------------------------
            const dataGroups = {
                group1: [
                    { label: '会社:', value: companyName },
                    { label: '部署:', value: department },
                    { label: '使用場所:', value: usageLocation },
                    { label: 'センサー名:', value: sensorName },
                    { label: '測定期間:', value: startToEndString },
                    { label: 'DevEUI:', value: devEui }
                ],
                group2: [
                    { label: 'データタイプ:', value: 'Temperature' },
                    { label: 'サンプリング数:', value: tempCount.toString() },
                    { label: '最大値:', value: formatNumber(tempMax) },
                    { label: '最小値:', value: formatNumber(tempMin) },
                    { label: '平均値:', value: formatNumber(tempAvg) },
                ],
                group3: [
                    { label: 'データタイプ:', value: 'Humidity' },
                    { label: 'サンプリング数:', value: humCount.toString() },
                    { label: '最大湿度:', value: formatNumber(humMax) + '%' },
                    { label: '最小湿度:', value: formatNumber(humMin) + '%' },
                    { label: '平均湿度:', value: formatNumber(humAvg) + '%' },
                ],
                group4: [
                    { label: 'データタイプ:', value: 'CO2' },
                    { label: 'サンプリング数:', value: co2Count.toString() },
                    { label: '最大CO2濃度:', value: formatNumber(co2Max) + 'ppm' },
                    { label: '最小CO2濃度:', value: formatNumber(co2Min) + 'ppm' },
                    { label: '平均CO2濃度:', value: formatNumber(co2Avg) + 'ppm' }
                ]
            };

            doc.moveDown(); // ensure some space
            doc.x = 0;
            drawFourDataGroups(doc, dataGroups, {
                fontSize: 6,
                rowHeight: 20,
                labelWidth: 65,
                valueWidth: 78,
                gapBetweenCols: 3,
                drawColumnDividers: true,
                labelGap: 10,
                alternateRowShading: true,
                shadeColor1: '#f9f9f9',
                shadeColor2: '#ececec'
            });
            // doc.y is now below all four groups

            // Suppose you only want the chart to be 200 points tall max:
            await drawChartWithD3VariableHeight(
              doc,
              reportData.map((d) => ({
                date: new Date(d.created_at),
                value: d.temperature_c
              })),
              { title: "温度", lineColor: 'red', maxHeight: 150 }
            );

            await drawChartWithD3VariableHeight(
              doc,
              reportData.map((d) => ({
                date: new Date(d.created_at),
                value: d.humidity
              })),
              { title: '湿度', lineColor: 'blue', maxHeight: 150 }
            );

            await drawChartWithD3VariableHeight(
              doc,
              reportData.map((d) => ({
                date: new Date(d.created_at),
                value: d.co2
              })),
              { title: 'CO2', lineColor: 'green', maxHeight: 200 }
            );

            // Draw the table
            const columns: TableHeader[] = [
                { key: 'createdAt', label: '日時', width: 75 },
                { key: 'temperature', label: '温度', width: 30 },
                { key: 'humidity', label: '湿度', width: 30 },
                { key: 'co2', label: 'CO2', width: 37 },
                { key: 'comment', label: 'コメント', width: 85 },
            ];
              
            // data: e.g. from
            const data = reportData.map(d => ({
                createdAt: moment(d.created_at).format('YYYY/MM/DD HH:mm'),
                temperature: d.temperature_c,
                humidity: d.humidity,
                co2: d.co2,
                comment: "",
            }));
              
            // colorRanges if you need them
            const colorRanges = [];
              
            // Then:
            drawDynamicDataTable2(doc, columns, data, colorRanges, {
                rowHeight: 16,
                headerHeight: 16,
                marginBottom: 20,
                headerFontSize: 8,
                bodyFontSize: 7
            });

            // Finalize the PDF (triggers the 'end' event)
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

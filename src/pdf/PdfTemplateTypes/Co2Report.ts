import PDFDocument from 'pdfkit';
import { drawDynamicTable, TableColumn } from '../pdf-parts/drawDynamicTable';
import { drawFourDataGroups } from '../pdf-parts/drawFourDataGroups';
import { drawSimpleLineChartD3Style } from '../pdf-parts/drawBetterChartWithD3';
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

            doc.registerFont('NotoSansJP', 'src/assets/fonts/Noto_Sans_JP/static/NotoSansJP-Regular.ttf');
            doc.font('NotoSansJP');

            doc.x = doc.page.margins.left;
            doc.fontSize(14).text('CO2 Report', 0, 0, { width: doc.page.width, align: 'center' });
            doc.x = doc.page.margins.left;

            // Collect chunks in memory
            const buffers: Buffer[] = [];
            doc.on('data', (chunk) => buffers.push(chunk));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            let header: TableColumn[] = [];
            Object.keys(reportData[0]).forEach((key) => {
                if (key === 'co2_level' || key === 'created_at' || key === 'temperatureC' || key === 'humidity') {

                    header.push({
                        header: key,
                        field: key,
                        width: 50
                    });
                }
            });

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
                    { label: 'サンプリング数:', value: '100' },
                    { label: '最大値:', value: '30.2' },
                    { label: '最小値:', value: '-5.1' },
                    { label: '平均値:', value: '12.3' }
                ],
                group3: [
                    { label: 'データタイプ:', value: 'Humidity' },
                    { label: 'サンプリング数:', value: '100' },
                    { label: '最大湿度:', value: '90.0%' },
                    { label: '最小湿度:', value: '35.2%' },
                    { label: '平均湿度:', value: '62.8%' }
                ],
                group4: [
                    { label: 'データタイプ:', value: 'CO2' },
                    { label: 'サンプリング数:', value: '100' },
                    { label: '最大CO2濃度:', value: '850ppm' },
                    { label: '最小CO2濃度:', value: '400ppm' },
                    { label: '平均CO2濃度:', value: '550ppm' }
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
            await drawChartWithD3VariableHeight(doc, reportData.map((d) => ({ date: new Date(d.created_at), value: d.temperature })), { title: "温度", lineColor: 'red', maxHeight: 150 });
            await drawChartWithD3VariableHeight(doc, reportData.map((d) => ({ date: new Date(d.created_at), value: d.humidity })), { title: '湿度', lineColor: 'blue', maxHeight: 150 });
            await drawChartWithD3VariableHeight(doc, reportData.map((d) => ({ date: new Date(d.created_at), value: d.co2_level })), { title: 'CO2', lineColor: 'green', maxHeight: 200 });


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
                createdAt: moment(d.date).format('YYYY/MM/DD HH:mm'),
                temperature: d.temperature,
                humidity: d.humidity,
                co2: d.co2_level,
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
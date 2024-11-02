import { Injectable } from '@nestjs/common';
import { join } from 'path';
import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions, TFontDictionary } from 'pdfmake/build/pdfmake';

@Injectable()
export class PdfService {
    
    public async createPdfBinary(): Promise<Buffer> {
        console.log('path', join(process.cwd(), 'dist', '', 'src/pdf/fonts/Roboto/Roboto-Regular.ttf'));
        const fonts: TFontDictionary = {
            Roboto: {
                normal: join(process.cwd(), 'dist', '', 'src/pdf/fonts/Roboto/Roboto-Regular.ttf'),
                bold: join(process.cwd(), 'dist', '', 'src/pdf/fonts/Roboto/Roboto-Medium.ttf'),
                italics: join(process.cwd(), 'dist', '', 'src/pdf/fonts/Roboto/Roboto-Italic.ttf'),
                bolditalics: join(process.cwd(), 'dist', '', 'src/pdf/fonts/Roboto/Roboto-MediumItalic.ttf'),
            },
        };
        const printer: PdfPrinter = new PdfPrinter(fonts);
        const docDefinition: any = {
            content: [
                'First paragraph',
                'Another paragraph, this time a little bit longer to make sure, this line will be divided into at least two lines',
            ],
        };

        return new Promise((resolve, reject) => {
            const pdfDoc = printer.createPdfKitDocument(docDefinition);
            const chunks: Buffer[] = [];

            pdfDoc.on('data', (chunk) => chunks.push(chunk));
            pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
            pdfDoc.on('error', reject);
            
            pdfDoc.end();
        });
    }
}

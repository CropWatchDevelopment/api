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

        const report = JSON.stringify({
            permissions: {
                printing: 'highResolution',
                modifying: false,
                copying: true,
                annotating: true,
                fillingForms: true,
                contentAccessibility: true,
                documentAssembly: true
            },
            content: [
                {
                    text: 'REPORT',
                    style: 'header'
                },
                {
                    columns: [
                        [
                            {
                                columns: [
                                    {
                                        ul: [
                                            'item 1',
                                            'item 2',
                                            'item 3'
                                        ]
                                    },
                                    { text: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit. Malit profecta versatur nomine ocurreret multavit, officiis viveremus aeternum superstitio suspicor alia nostram, quando nostros congressus susceperant concederetur leguntur iam, vigiliae democritea tantopere causae, atilii plerumque ipsas potitur pertineant multis rem quaeri pro, legendum didicisse credere ex maluisset per videtis. Cur discordans praetereat aliae ruinae dirigentur orestem eodem, praetermittenda divinum. Collegisti, deteriora malint loquuntur officii cotidie finitas referri doleamus ambigua acute. Adhaesiones ratione beate arbitraretur detractis perdiscere, constituant hostis polyaeno. Diu concederetur.' },
                                    {
                                        style: 'tableExample',
                                        table: {
                                            body: [
                                                ['承認', '確認', '作成'],
                                                [' ', ' ', ' ']
                                            ]
                                        }
                                    },
                                ]
                            }
                        ]
                    ]
                },
            ],
            styles: {
                header: {
                    fontSize: 18,
                    bold: true
                },
            }
        });



        const printer: PdfPrinter = new PdfPrinter(fonts);
        const docDefinition: any = JSON.parse(report) as TDocumentDefinitions;

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

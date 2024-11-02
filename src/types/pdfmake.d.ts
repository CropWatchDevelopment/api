declare module 'pdfmake' {
    import { TDocumentDefinitions, TFontDictionary } from 'pdfmake/build/pdfmake';
    class PdfPrinter {
        constructor(fonts: TFontDictionary);
        createPdfKitDocument(docDefinition: TDocumentDefinitions): any;
    }
    export = PdfPrinter;
}

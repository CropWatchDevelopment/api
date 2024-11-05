import { join } from 'path';

export function getFontPaths(fontFamily: string, basePath: string) {
    return {
        normal: join(process.cwd(), 'dist', '', basePath, `${fontFamily}-Regular.ttf`),
        bold: join(process.cwd(), 'dist', '', basePath, `${fontFamily}-Medium.ttf`),
        italics: join(process.cwd(), 'dist', '', basePath, `${fontFamily}-Italic.ttf`),
        bolditalics: join(process.cwd(), 'dist', '', basePath, `${fontFamily}-MediumItalic.ttf`),
    };
}
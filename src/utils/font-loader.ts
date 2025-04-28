import { join } from 'path';

export function getFontPaths(fontFamily: string, basePath: string) {
  // Using process.cwd() as the base path can be problematic in serverless environments
  // Instead, use a more reliable path construction that works in all environments
  return {
    normal: join(__dirname, '..', basePath, `${fontFamily}-Regular.ttf`),
    bold: join(__dirname, '..', basePath, `${fontFamily}-Medium.ttf`),
    italics: join(__dirname, '..', basePath, `${fontFamily}-Italic.ttf`),
    bolditalics: join(__dirname, '..', basePath, `${fontFamily}-MediumItalic.ttf`),
  };
}
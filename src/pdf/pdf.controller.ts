// pdf.controller.ts
import { Controller, Get, StreamableFile, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PdfService } from './pdf.service';
import { Public } from 'src/auth/public.decorator';

@ApiTags('📄 PDF - Serve a PDF file')
@Controller('pdf')
export class PdfController {
    constructor(private readonly pdfService: PdfService) {}

    @Public()
    @Get()
    async getFile(@Res() res: Response): Promise<void> {
        const pdfBuffer = await this.pdfService.createPdfBinary();
        
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="report.pdf"',
            'Content-Length': pdfBuffer.length,
        });

        res.send(pdfBuffer);
    }
}

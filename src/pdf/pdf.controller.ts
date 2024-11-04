// pdf.controller.ts
import { Controller, Get, Res, UseGuards, Req, Body, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PdfService } from './pdf.service';
import { SupabaseAuthGuard } from 'src/auth/guards/supabase.guard';

@ApiTags('📄 PDF - Serve a PDF file')
@Controller('pdf')
export class PdfController {
    constructor(private readonly pdfService: PdfService) {}

    @Get()
    @ApiSecurity('x-api-key', ['x-api-key'])
    @ApiBearerAuth('JWT')
    @UseGuards(SupabaseAuthGuard)
    async getFile(
        @Res() res: Response,
        @Req() req,
        @Query('devEui') devEui: string
    ): Promise<void> {
        
        const user_id = req.user.id;
        
        const pdfBuffer = await this.pdfService.createPdfBinary(user_id, devEui);
        
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="report.pdf"',
            'Content-Length': pdfBuffer.length,
        });

        res.send(pdfBuffer);
    }
}

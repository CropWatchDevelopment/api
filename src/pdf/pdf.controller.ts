// pdf.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Res,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProduces, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PdfService } from './pdf.service';
import { SupabaseAuthGuard } from 'src/auth/guards/supabase.guard';

@ApiBearerAuth('JWT')
@ApiSecurity('x-api-key', ['x-api-key'])
@ApiTags('📄 CSV,XML,PDF - Data Export')
@Controller('pdf')
export class PdfController {
  constructor(private readonly pdfService: PdfService) { }

  @Get()
  @ApiSecurity('x-api-key', ['x-api-key'])
  @ApiBearerAuth('JWT')
  @UseGuards(SupabaseAuthGuard)
  @ApiQuery({
    name: 'startDate',
    required: true,
    type: 'string',
    description: 'Start date (format: YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    type: 'string',
    description: 'End date (format: YYYY-MM-DD)',
  })
  @ApiOkResponse({
    description: 'PDF file',
    headers: {
      'Content-Disposition': {
        description: 'Indicates a file attachment with filename',
        schema: { type: 'string' },
      },
    },
    content: {
      'application/pdf': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiProduces('application/pdf')
  async getFile(
    @Res() res: Response,
    @Req() req,
    @Query('devEui') devEui: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ): Promise<void> {
    // Convert string inputs to dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Adjust to start-of-day and end-of-day
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // Validate that start is not after end
    if (start > end) {
      throw new BadRequestException('Start date cannot be after end date.');
    }

    const user_id = req.user.id;

    // Pass the dates to your service if needed:
    const reportResponse = await this.pdfService.createPdfBinary(
      user_id,
      devEui,
      start,
      end,
    );

    const pdfBuffer = reportResponse.pdf;
    const encodedFilename = this.encodeRFC5987ValueChars(reportResponse.fileName);
    console.log(reportResponse.fileName)
    res.set({
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}.pdf`,
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
    });

    res.send(pdfBuffer);
  }

  private encodeRFC5987ValueChars(str) {
    return encodeURIComponent(str)
      // RFC 5987 requires these characters to be percent-encoded
      .replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16));
  }
}

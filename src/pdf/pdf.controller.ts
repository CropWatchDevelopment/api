// pdf.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Res,
  UseGuards,
  Req,
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProduces, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PdfService } from './pdf.service';
import { SupabaseAuthGuard } from 'src/auth/guards/supabase.guard';
import moment from 'moment';

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
    const start = moment(startDate).tz('Asia/Tokyo').startOf('day').toDate();
    const end = moment(endDate).tz('Asia/Tokyo').endOf('day').toDate();

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
    if (!Buffer.isBuffer(pdfBuffer)) {
      throw new InternalServerErrorException('Failed to generate PDF');
    }
    const encodedFilename = this.encodeRFC5987ValueChars(reportResponse.fileName);
    console.log('Setting headers:', {
      'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
    });
    res.set({
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
    });

    // Verify headers were set
    console.log('Response headers after setting:', res.getHeaders());

    res.end(pdfBuffer); // Use end() to send raw buffer
    // Do not return anything when using @Res()
  }

  private encodeRFC5987ValueChars(str) {
    return encodeURIComponent(str)
      // RFC 5987 requires these characters to be percent-encoded
      .replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16));
  }
}
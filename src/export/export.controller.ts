import { Controller, Get, HttpStatus, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from 'src/auth/guards/supabase.guard';
import { ExportService } from './export.service';
import { Response } from 'express';

export enum ExportType {
  CSV = 'CSV',
  XML = 'XML',
}

@ApiBearerAuth('JWT')
@ApiSecurity('x-api-key', ['x-api-key'])
@ApiTags('📄 CSV,XML,PDF - Data Export')
@Controller('Export')
@Controller('export')
export class ExportController {

  constructor(private readonly exportService: ExportService) { }

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
  @ApiQuery({ name: 'exportType', enum: ExportType, required: true })
  async getFile(
    @Res() res: Response,
    @Req() req,
    @Query('devEui') devEui: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('exportType') exportType: ExportType = ExportType.CSV,
  ) {
    const user_id = req.user.id;
    if (!user_id) {
      throw new Error('User ID is required');
    }
    if (!devEui) {
      throw new Error('DevEui is required');
    }
    if (!startDate) {
      throw new Error('Start date is required');
    }
    if (!endDate) {
      throw new Error('End date is required');
    }

    const data = await this.exportService.getFile(
      user_id,
      devEui,
      exportType,
      startDate,
      endDate,
    );
    if (!data) {
      throw new Error('Data not found');
    }

    if (exportType === ExportType.CSV) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
      res.status(HttpStatus.OK).send(data);
    } else {
      res.setHeader('Content-Type', 'text/xml');
      res.setHeader('Content-Disposition', 'attachment; filename="export.xml"');
      res.status(HttpStatus.OK).send(data);
    }
  }
}

import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ApiBearerAuth, ApiOkResponse, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { ReportDto } from './dto/report.dto';

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) { }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Create a new report. Only the fields included in the request body will be used.",
    type: CreateReportDto,
    isArray: false,
  })
  @Post()
  create(@Body() createReportDto: CreateReportDto, @Req() req) {
    const authHeader = req.headers?.authorization;
    if (!authHeader) {
      throw new Error('Authorization header is required');
    }
    return this.reportsService.create(createReportDto, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Fetch all reports. Only the fields included in the request body will be used.",
    type: ReportDto,
    isArray: true,
  })
  @Get()
  findAll(@Req() req) {
    const authHeader = req.headers?.authorization;
    if (!authHeader) {
      throw new Error('Authorization header is required');
    }
    return this.reportsService.findAll(req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Fetch a specific report by its ID.",
    type: ReportDto,
    isArray: false,
  })
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req) {
    const authHeader = req.headers?.authorization;
    if (!authHeader) {
      throw new Error('Authorization header is required');
    }
    return this.reportsService.findOne(id, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Update an existing report. Only the fields included in the request body will be used.",
    type: ReportDto,
    isArray: false,
  })
  @Patch(':report_id')
  update(@Param('report_id') report_id: string, @Body() updateReportDto: UpdateReportDto, @Req() req) {
    const authHeader = req.headers?.authorization;
    if (!authHeader) {
      throw new Error('Authorization header is required');
    }
    return this.reportsService.update(report_id, updateReportDto, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Remove an existing report. Only the fields included in the request body will be used.",
    type: Number,
    isArray: false,
  })
  @Delete(':report_id')
  remove(@Param('report_id') report_id: string, @Req() req) {
    const authHeader = req.headers?.authorization;
    if (!authHeader) {
      throw new Error('Authorization header is required');
    }
    return this.reportsService.remove(report_id, req.user, authHeader);
  }
}

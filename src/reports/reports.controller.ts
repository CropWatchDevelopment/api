import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ApiBearerAuth, ApiOkResponse, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt.auth.guard';
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
  create(@Body() createReportDto: CreateReportDto) {
    return this.reportsService.create(createReportDto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Fetch all reports. Only the fields included in the request body will be used.",
    type: ReportDto,
    isArray: true,
  })
  @Get()
  findAll() {
    return this.reportsService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Fetch a specific report by its ID.",
    type: ReportDto,
    isArray: false,
  })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.reportsService.findOne(+id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Update an existing report. Only the fields included in the request body will be used.",
    type: ReportDto,
    isArray: false,
  })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateReportDto: UpdateReportDto) {
    return this.reportsService.update(+id, updateReportDto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Create a new rule configuration. Only the fields included in the request body will be used.",
    type: Number,
    isArray: false,
  })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.reportsService.remove(+id);
  }
}

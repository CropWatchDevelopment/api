import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiQuery,
  ApiSecurity,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { CommunicationMethodDto } from './dto/communication-method.dto';
import { ReportFormContextDto } from './dto/report-form-context.dto';
import { ReportTemplateDto } from './dto/report-template.dto';
import { ReportTemplateHistoryItemDto } from './dto/report-template-history-item.dto';
import { SaveReportTemplateDto } from './dto/save-report-template.dto';
import { ReportsNewService } from './reports-new.service';

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller({ path: 'reports-new', version: '1' })
export class ReportsNewController {
  constructor(private readonly reportsNewService: ReportsNewService) {}

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Lists every report template visible to the current user.',
    type: ReportTemplateDto,
    isArray: true,
  })
  @ApiQuery({
    name: 'search',
    description: 'Filter templates by name, description, or assigned device.',
    required: false,
  })
  @Get()
  findAll(@Req() req, @Query('search') search?: string) {
    const authHeader = req.headers?.authorization ?? '';
    return this.reportsNewService.findAll(req.user, authHeader, search);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      'Lists every communication method a report template recipient can use.',
    type: CommunicationMethodDto,
    isArray: true,
  })
  @Get('communication-methods')
  findAllCommunicationMethods(@Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.reportsNewService.findAllCommunicationMethods(authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      'Bundled data needed to render the reports-new create/edit form: devices (with cw_locations join), locations, communication methods, and optionally a template.',
    type: ReportFormContextDto,
  })
  @ApiQuery({
    name: 'templateId',
    description: 'When provided, the matching report template is included in the response.',
    required: false,
    type: Number,
  })
  @Get('form-context')
  getFormContext(@Req() req, @Query('templateId') templateId?: string) {
    const authHeader = req.headers?.authorization ?? '';
    const parsed = templateId !== undefined ? Number(templateId) : NaN;
    const id = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    return this.reportsNewService.getFormContext(req.user, authHeader, id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      'Returns a signed URL to download a generated report PDF for a device the user can view.',
    schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
    },
  })
  @Get('download/:dev_eui/:reportName')
  download(
    @Param('dev_eui') devEui: string,
    @Param('reportName') reportName: string,
    @Req() req,
  ) {
    const authHeader = req.headers?.authorization ?? '';
    return this.reportsNewService.getDownloadUrl(
      devEui,
      reportName,
      req.user,
      authHeader,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Lists generated report PDFs across the template's assigned devices, newest first.",
    type: ReportTemplateHistoryItemDto,
    isArray: true,
  })
  @Get(':id/history')
  findHistory(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.reportsNewService.getHistory(id, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Returns a single report template the user can view.',
    type: ReportTemplateDto,
    isArray: false,
  })
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.reportsNewService.findOne(id, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Creates a report template and assigns it to the listed devices.',
    type: ReportTemplateDto,
    isArray: false,
  })
  @ApiBody({ type: SaveReportTemplateDto })
  @Post()
  create(@Body() body: SaveReportTemplateDto, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.reportsNewService.create(body, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Replaces a report template with the provided configuration.',
    type: ReportTemplateDto,
    isArray: false,
  })
  @ApiBody({ type: SaveReportTemplateDto })
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SaveReportTemplateDto,
    @Req() req,
  ) {
    const authHeader = req.headers?.authorization ?? '';
    return this.reportsNewService.update(id, body, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Deletes a report template the user manages.',
    schema: {
      type: 'object',
      properties: { id: { type: 'number' } },
    },
  })
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.reportsNewService.remove(id, req.user, authHeader);
  }
}

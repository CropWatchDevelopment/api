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
import { RuleActionTypeDto } from './dto/rule-action-type.dto';
import { RuleFormContextDto } from './dto/rule-form-context.dto';
import { RuleTemplateDto } from './dto/rule-template.dto';
import { RuleTriggerLogDto } from './dto/rule-trigger-log.dto';
import { SaveRuleTemplateDto } from './dto/save-rule-template.dto';
import { RulesNewService } from './rules-new.service';

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller({ path: 'rules-new', version: '1' })
export class RulesNewController {
  constructor(private readonly rulesNewService: RulesNewService) {}

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: "Lists every rule template visible to the current user.",
    type: RuleTemplateDto,
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
    return this.rulesNewService.findAll(req.user, authHeader, search);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Lists every action type a rule template action can reference.',
    type: RuleActionTypeDto,
    isArray: true,
  })
  @Get('action-types')
  findAllActionTypes(@Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesNewService.findAllActionTypes(authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      'Bundled data needed to render the rules-new create/edit form: devices (with cw_locations join), locations, action types, and optionally a template.',
    type: RuleFormContextDto,
  })
  @ApiQuery({
    name: 'templateId',
    description: 'When provided, the matching rule template is included in the response.',
    required: false,
    type: Number,
  })
  @Get('form-context')
  getFormContext(
    @Req() req,
    @Query('templateId') templateId?: string,
  ) {
    const authHeader = req.headers?.authorization ?? '';
    const parsed = templateId !== undefined ? Number(templateId) : NaN;
    const id = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    return this.rulesNewService.getFormContext(req.user, authHeader, id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      'Lists rule templates that are currently triggered on at least one device the user can view; assignments are narrowed to the triggered ones.',
    type: RuleTemplateDto,
    isArray: true,
  })
  @Get('triggered')
  findAllTriggered(@Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesNewService.findAllTriggered(req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      'Counts of currently-triggered rule templates and of all visible rule templates.',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'number' },
        triggered_count: { type: 'number' },
        total_count: { type: 'number' },
      },
    },
  })
  @Get('triggered/count')
  findTriggeredCount(@Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesNewService.findTriggeredCount(req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      'Lists the trigger/reset history for a rule template, newest first.',
    type: RuleTriggerLogDto,
    isArray: true,
  })
  @Get(':id/history')
  findHistory(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesNewService.getHistory(id, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Returns a single rule template the user can view.',
    type: RuleTemplateDto,
    isArray: false,
  })
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesNewService.findOne(id, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Creates a rule template and assigns it to the listed devices.',
    type: RuleTemplateDto,
    isArray: false,
  })
  @ApiBody({ type: SaveRuleTemplateDto })
  @Post()
  create(@Body() body: SaveRuleTemplateDto, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesNewService.create(body, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Replaces a rule template with the provided configuration.',
    type: RuleTemplateDto,
    isArray: false,
  })
  @ApiBody({ type: SaveRuleTemplateDto })
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SaveRuleTemplateDto,
    @Req() req,
  ) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesNewService.update(id, body, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Deletes a rule template the user manages.',
    schema: {
      type: 'object',
      properties: { id: { type: 'number' } },
    },
  })
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesNewService.remove(id, req.user, authHeader);
  }
}

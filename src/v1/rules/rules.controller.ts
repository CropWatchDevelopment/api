import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
import { RuleCatalogDto } from './dto/rule-catalog.dto';
import { RuleDeviceStateDto } from './dto/rule-device-state.dto';
import { RuleFormContextDto } from './dto/rule-form-context.dto';
import { RuleTemplateDto } from './dto/rule-template.dto';
import { RuleTriggerLogDto } from './dto/rule-trigger-log.dto';
import { SaveRuleTemplateDto } from './dto/save-rule-template.dto';
import { RulesService } from './rules.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller({ path: 'rules', version: '1' })
@UseGuards(JwtAuthGuard)
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}
  @ApiOkResponse({
    description: 'Lists every rule template visible to the current user.',
    type: RuleTemplateDto,
    isArray: true,
  })
  @ApiQuery({
    name: 'search',
    description: 'Filter templates by name, description, or assigned device.',
    required: false,
  })
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
  ) {
    return this.rulesService.findAll(user, search);
  }
  @ApiOkResponse({
    description:
      'Lists every action type a rule template action can reference.',
    type: RuleActionTypeDto,
    isArray: true,
  })
  @Get('action-types')
  findAllActionTypes() {
    return this.rulesService.findAllActionTypes();
  }
  @ApiOkResponse({
    description:
      'Bundled data needed to render the rules create/edit form: devices (with cw_locations join), locations, action types, and optionally a template.',
    type: RuleFormContextDto,
  })
  @ApiQuery({
    name: 'templateId',
    description:
      'When provided, the matching rule template is included in the response.',
    required: false,
    type: Number,
  })
  @Get('form-context')
  getFormContext(
    @CurrentUser() user: AuthenticatedUser,
    @Query('templateId') templateId?: string,
  ) {
    const parsed = templateId !== undefined ? Number(templateId) : NaN;
    const id = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    return this.rulesService.getFormContext(user, id);
  }
  @ApiOkResponse({
    description:
      'Lists rule templates that are currently triggered on at least one device the user can view; assignments are narrowed to the triggered ones.',
    type: RuleTemplateDto,
    isArray: true,
  })
  @Get('triggered')
  findAllTriggered(@CurrentUser() user: AuthenticatedUser) {
    return this.rulesService.findAllTriggered(user);
  }
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
  findTriggeredCount(@CurrentUser() user: AuthenticatedUser) {
    return this.rulesService.findTriggeredCount(user);
  }
  @ApiOkResponse({
    description:
      'Active rule templates the caller can see, each with its assigned devices only. Trimmed for low-power provisioning clients (ESP32 bridge portal).',
    type: RuleCatalogDto,
  })
  @Header('Cache-Control', 'no-store')
  @Get('catalog')
  getCatalog(@CurrentUser() user: AuthenticatedUser) {
    return this.rulesService.getCatalog(user);
  }
  @ApiOkResponse({
    description:
      'Current rule state for the requested devices, shaped for low-power polling clients. Pairs without a state row have never triggered and are omitted; treat absence as not triggered.',
    type: RuleDeviceStateDto,
  })
  @ApiQuery({
    name: 'dev_eui',
    description:
      'Device EUI to include. Repeatable, or a single comma-separated list.',
    required: true,
    type: String,
    isArray: true,
  })
  @Header('Cache-Control', 'no-store')
  @Get('state')
  getStateForDevices(
    @CurrentUser() user: AuthenticatedUser,
    @Query('dev_eui') devEui?: string | string[],
  ) {
    const devEuis = (Array.isArray(devEui) ? devEui : devEui ? [devEui] : [])
      .flatMap((entry) => entry.split(','))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return this.rulesService.getStateForDevices(user, devEuis);
  }
  @ApiOkResponse({
    description:
      'Lists the trigger/reset history for a rule template, newest first.',
    type: RuleTriggerLogDto,
    isArray: true,
  })
  @Get(':id/history')
  findHistory(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rulesService.getHistory(id, user);
  }
  @ApiOkResponse({
    description: 'Returns a single rule template the user can view.',
    type: RuleTemplateDto,
    isArray: false,
  })
  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rulesService.findOne(id, user);
  }
  @ApiOkResponse({
    description:
      'Creates a rule template and assigns it to the listed devices.',
    type: RuleTemplateDto,
    isArray: false,
  })
  @ApiBody({ type: SaveRuleTemplateDto })
  @Post()
  create(
    @Body() body: SaveRuleTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rulesService.create(body, user);
  }
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rulesService.update(id, body, user);
  }
  @ApiOkResponse({
    description: 'Deletes a rule template the user manages.',
    schema: {
      type: 'object',
      properties: { id: { type: 'number' } },
    },
  })
  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rulesService.remove(id, user);
  }
}

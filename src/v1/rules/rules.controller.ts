import { Controller, Get, Post, Body, Patch, Param, Delete, Req, UseGuards } from '@nestjs/common';
import { RulesService } from './rules.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { RuleDto } from './dto/rule.dto';
import { IRuleCountDto } from './dto/ruleCount.dto';

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller('rules')
export class RulesController {
  constructor(private readonly rulesService: RulesService) { }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Create a new rule configuration. Only the fields included in the request body will be used.",
    type: RuleDto,
    isArray: false,
  })
  @ApiBody({ type: CreateRuleDto })
  @Post()
  create(@Body() createRuleDto: CreateRuleDto, @Req() req) {
    const authHeader = req.headers?.authorization;
    if (!authHeader) {
      throw new Error('Authorization header is required');
    }
    return this.rulesService.create(createRuleDto, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Current all of the user's rules configurations.",
    type: RuleDto,
    isArray: true,
  })
  @Get()
  findAll(@Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesService.findAll(req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Current all of the user's triggered rules configurations.",
    type: Number,
    isArray: false,
  })
  @Get('triggered')
  findAllTriggered(@Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesService.findAllTriggered(req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Gets the count of the user's triggered rules configurations.",
    type: IRuleCountDto,
    isArray: false,
  })
  @Get('triggered/count')
  findTriggeredCount(@Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesService.findTriggeredCount(req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Gets a user's rule configuration by ID.",
    type: RuleDto,
    isArray: false,
  })
  @Get(':id')
  findOne(@Param('id') id: number, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesService.findOne(id, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Update a single rule configuration by ID. Only the fields included in the request body will be updated.",
    type: RuleDto,
    isArray: false,
  })
  @ApiBody({ type: UpdateRuleDto })
  @Patch(':id')
  update(@Param('id') id: number, @Body() updateRuleDto: UpdateRuleDto, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesService.update(id, updateRuleDto, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Delete a user's rule configuration by ID.",
    type: Number,
    isArray: false,
  })
  @Delete(':id')
  remove(@Param('id') id: number, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.rulesService.remove(id, req.user, authHeader);
  }
}

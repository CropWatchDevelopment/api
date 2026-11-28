import { ApiProperty } from '@nestjs/swagger';
import { DeviceDto } from '../../devices/dto/device.dto';
import { LocationDto } from '../../locations/dto/location.dto';
import { RuleActionTypeDto } from './rule-action-type.dto';
import { RuleOptionDto } from './rule-status.dto';
import { RuleTemplateDto } from './rule-template.dto';

export class RuleFormContextDto {
  @ApiProperty({ type: () => DeviceDto, isArray: true })
  devices: DeviceDto[];

  @ApiProperty({ type: () => LocationDto, isArray: true })
  locations: LocationDto[];

  @ApiProperty({ type: () => RuleActionTypeDto, isArray: true })
  actionTypes: RuleActionTypeDto[];

  @ApiProperty({ type: () => RuleTemplateDto, nullable: true, required: false })
  template: RuleTemplateDto | null;

  @ApiProperty({
    type: () => RuleOptionDto,
    isArray: true,
    description:
      'Rules this rule may start or pause: the ones the caller manages in full, each inside one organization.',
  })
  ruleOptions: RuleOptionDto[];

  @ApiProperty({
    description:
      'Whether the caller may create Date/Time rules (owner or manager of an organization, or staff).',
  })
  canManageDateTimeRules: boolean;
}

import { ApiProperty } from '@nestjs/swagger';
import { DeviceDto } from '../../devices/dto/device.dto';
import { LocationDto } from '../../locations/dto/location.dto';
import { RuleActionTypeDto } from './rule-action-type.dto';
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
}

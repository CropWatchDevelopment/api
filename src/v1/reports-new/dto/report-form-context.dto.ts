import { ApiProperty } from '@nestjs/swagger';
import { DeviceDto } from '../../devices/dto/device.dto';
import { LocationDto } from '../../locations/dto/location.dto';
import { CommunicationMethodDto } from './communication-method.dto';
import { ReportTemplateDto } from './report-template.dto';

export class ReportFormContextDto {
  @ApiProperty({ type: () => DeviceDto, isArray: true })
  devices: DeviceDto[];

  @ApiProperty({ type: () => LocationDto, isArray: true })
  locations: LocationDto[];

  @ApiProperty({ type: () => CommunicationMethodDto, isArray: true })
  communicationMethods: CommunicationMethodDto[];

  @ApiProperty({ type: () => ReportTemplateDto, nullable: true, required: false })
  template: ReportTemplateDto | null;
}

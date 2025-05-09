import { IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { BaseDeviceDto } from '../../common/dto/base-dev-eui.dto';

export class CreateReportTemplateDto extends BaseDeviceDto {
  @IsNotEmpty()
  @IsString()
  serial_number: string;

  @IsNotEmpty()
  @IsString()
  user_id: string;
}

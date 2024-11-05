import { IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { BaseDevEuiDto } from 'src/common/dto/base-dev-eui.dto';

export class CreateReportTemplateDto extends BaseDevEuiDto {

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsNumber()
  type: number;

  @IsNotEmpty()
  @IsString()
  serial_number: string;

  @IsNotEmpty()
  @IsString()
  user_id: string;
}

import { IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { BaseDeviceDto } from 'src/common/dto/base-dev-eui.dto';

export class CreateDeviceDto extends BaseDeviceDto {

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

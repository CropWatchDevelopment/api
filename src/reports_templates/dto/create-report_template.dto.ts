import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateReportTemplateDto {
  @IsNotEmpty()
  @IsString()
  dev_eui: string;

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

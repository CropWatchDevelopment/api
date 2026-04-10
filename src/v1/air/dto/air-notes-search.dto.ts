import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator/types/decorator/string/IsISO8601';

export class AirNotesSearchDto {
  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  date: string;

  @ApiProperty()
  dev_eui: string;
}

import { ApiProperty } from '@nestjs/swagger';

export class ReportTemplateAlertPointDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  templateId: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  dataPointKey: string;

  @ApiProperty({ nullable: true, required: false })
  operator: string | null;

  @ApiProperty({ nullable: true, required: false })
  min: number | null;

  @ApiProperty({ nullable: true, required: false })
  max: number | null;

  @ApiProperty({ nullable: true, required: false })
  value: number | null;

  @ApiProperty({ nullable: true, required: false })
  hexColor: string | null;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  createdAt: string | null;
}

import { ApiProperty } from '@nestjs/swagger';

export class ReportTemplateAssignmentDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  devEui: string;

  @ApiProperty()
  templateId: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  createdAt: string | null;

  @ApiProperty({ nullable: true, required: false })
  deviceName: string | null;

  @ApiProperty({ nullable: true, required: false })
  locationName: string | null;

  @ApiProperty({ nullable: true, required: false })
  permissionLevel: number | null;
}

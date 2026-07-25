import { ApiProperty } from '@nestjs/swagger';

export class CommunicationMethodDto {
  @ApiProperty({
    description:
      'Stable identifier referenced by cw_report_template_recipients.communication_method.',
  })
  communicationMethodId: number;

  @ApiProperty({ nullable: true, required: false })
  name: string | null;

  @ApiProperty()
  isActive: boolean;
}

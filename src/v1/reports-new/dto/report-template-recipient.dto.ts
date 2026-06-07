import { ApiProperty } from '@nestjs/swagger';

export class ReportTemplateRecipientDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  templateId: number;

  @ApiProperty({
    description:
      'Foreign key to communication_methods.communication_method_id (1=email, 2=SMS, 3=Discord).',
  })
  communicationMethod: number;

  @ApiProperty({ nullable: true, required: false })
  email: string | null;

  @ApiProperty({ nullable: true, required: false })
  name: string | null;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  createdAt: string | null;
}

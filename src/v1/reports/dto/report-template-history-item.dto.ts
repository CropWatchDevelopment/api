import { ApiProperty } from '@nestjs/swagger';

/**
 * A generated report PDF in the `Reports` storage bucket, tagged with the
 * device it belongs to. A report template can span many devices, so history is
 * aggregated across the template's assigned devices.
 */
export class ReportTemplateHistoryItemDto {
  @ApiProperty()
  devEui: string;

  @ApiProperty({ nullable: true, required: false })
  deviceName: string | null;

  @ApiProperty({ description: 'Storage object name (the PDF file name).' })
  name: string;

  @ApiProperty({ nullable: true, required: false })
  id: string | null;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  createdAt: string | null;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  updatedAt: string | null;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  lastAccessedAt: string | null;

  @ApiProperty({ nullable: true, required: false })
  metadata: Record<string, unknown> | null;
}

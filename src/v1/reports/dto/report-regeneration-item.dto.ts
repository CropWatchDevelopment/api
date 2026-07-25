import { ApiProperty } from '@nestjs/swagger';

/**
 * A row in `cw_report_regeneration_queue`. Returned when a regeneration is
 * requested; the CW-Reports cron consumes pending rows and flips their status.
 */
export class ReportRegenerationItemDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  templateId: number;

  @ApiProperty()
  devEui: string;

  @ApiProperty({ format: 'date-time' })
  periodStart: string;

  @ApiProperty({ format: 'date-time' })
  periodEnd: string;

  @ApiProperty({ enum: ['pending', 'processing', 'completed', 'failed'] })
  status: string;

  @ApiProperty({ format: 'date-time' })
  requestedAt: string;

  @ApiProperty({
    description: 'Total note edits accumulated onto this queue row.',
  })
  editCount: number;
}

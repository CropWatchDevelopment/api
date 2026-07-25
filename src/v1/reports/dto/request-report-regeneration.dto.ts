import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Request body for queueing a regeneration of an already-generated report PDF
 * after the user edited its data-point notes. The period is echoed back from
 * the original storage object name (`YYYY_MM_DD-YYYY_MM_DD.pdf`) — reports
 * have no id of their own, so (template, device, period) identifies one.
 */
export class RequestReportRegenerationDto {
  @ApiProperty({ description: 'Device the original report belongs to.' })
  @IsString()
  @IsNotEmpty()
  devEui: string;

  @ApiProperty({ format: 'date-time', description: 'Report period start.' })
  @IsISO8601()
  periodStart: string;

  @ApiProperty({ format: 'date-time', description: 'Report period end.' })
  @IsISO8601()
  periodEnd: string;

  @ApiProperty({
    description:
      'Storage object name of the original PDF inside Reports/<dev_eui>/.',
  })
  @IsString()
  @IsNotEmpty()
  sourceObjectName: string;

  @ApiProperty({
    required: false,
    description:
      "IANA timezone of the report window. Defaults to 'Asia/Tokyo'.",
  })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({
    required: false,
    description:
      'Number of note edits in this save. Accumulates onto the pending row so the UI can show how many edits a queued regeneration covers. Defaults to 1.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  editCount?: number;
}

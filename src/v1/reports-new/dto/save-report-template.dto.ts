import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class SaveReportTemplateScheduleDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  endOfDay?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  endOfWeek?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  endOfMonth?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  utcOffset?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SaveReportTemplateRecipientDto {
  @ApiProperty({
    description:
      'Foreign key to communication_methods.communication_method_id.',
  })
  @IsInt()
  communicationMethod: number;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  email?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  name?: string | null;
}

export class SaveReportTemplateAlertPointDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dataPointKey: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  operator?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  min?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  max?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  value?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  hexColor?: string | null;
}

export class SaveReportTemplateDataProcessingScheduleDto {
  @ApiProperty({ description: 'Day of week, 0 (Sunday) – 6 (Saturday).' })
  @IsInt()
  dayOfWeek: number;

  @ApiProperty({ description: 'HH:MM(:SS) local time.' })
  @IsString()
  @IsNotEmpty()
  startTime: string;

  @ApiProperty({ description: 'HH:MM(:SS) local time.' })
  @IsString()
  @IsNotEmpty()
  endTime: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  crossesMidnight?: boolean;

  @ApiProperty({ required: false, description: "'include' or 'exclude'." })
  @IsOptional()
  @IsString()
  ruleType?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  validFrom?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  validTo?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class SaveReportTemplateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ required: false, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  dataPullInterval?: number;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  deviceTypeId?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ type: String, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  devEuis: string[];

  @ApiProperty({ type: () => SaveReportTemplateScheduleDto, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveReportTemplateScheduleDto)
  schedule?: SaveReportTemplateScheduleDto[];

  @ApiProperty({ type: () => SaveReportTemplateRecipientDto, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveReportTemplateRecipientDto)
  recipients?: SaveReportTemplateRecipientDto[];

  @ApiProperty({ type: () => SaveReportTemplateAlertPointDto, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveReportTemplateAlertPointDto)
  alertPoints?: SaveReportTemplateAlertPointDto[];

  @ApiProperty({
    type: () => SaveReportTemplateDataProcessingScheduleDto,
    isArray: true,
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveReportTemplateDataProcessingScheduleDto)
  dataProcessingSchedules?: SaveReportTemplateDataProcessingScheduleDto[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateDeviceNameGroupLocalDto {
    @ApiProperty({ example: 'New Device Name', type: String, required: true })
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name: string;

    @ApiPropertyOptional({ example: 'New Device Group', type: String, required: false })
    @IsOptional()
    @IsString()
    @MaxLength(120)
    group?: string | null;

    @ApiProperty({ example: 54, type: Number, required: true })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    location_id: number;
}

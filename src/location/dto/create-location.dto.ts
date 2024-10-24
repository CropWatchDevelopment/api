// src/dto/create-location.dto.ts
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsLatitude, IsLongitude } from 'class-validator';

export class CreateLocationDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsLatitude()
  lat?: number | null;

  @IsOptional()
  @IsLongitude()
  long?: number | null;

  @IsOptional()
  @IsNumber()
  map_zoom?: number | null;

  @IsOptional()
  @IsString()
  owner_id?: string | null;
}

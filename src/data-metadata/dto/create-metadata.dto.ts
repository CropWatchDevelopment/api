import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateMetadataDto {

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  notation: string;

  @IsString()
  icon: string;

  @IsNotEmpty()
  @IsNumber()
  multiplier: number;

  @IsNotEmpty()
  @IsNumber()
  adder: number;

}

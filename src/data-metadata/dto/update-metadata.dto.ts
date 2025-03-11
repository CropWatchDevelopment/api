import { PartialType } from '@nestjs/swagger';
import { CreateMetadataDto } from './create-metadata.dto';

export class UpdateMetadataDto extends PartialType(CreateMetadataDto) {}

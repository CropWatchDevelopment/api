import { PartialType } from '@nestjs/swagger';
import { CreateLocationOwnerDto } from './create-location-owner.dto';

export class UpdateLocationOwnerDto extends PartialType(CreateLocationOwnerDto) {}

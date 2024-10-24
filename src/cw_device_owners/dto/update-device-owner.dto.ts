// src/cw_device_owners/dto/update-device-owner.dto.ts
import { PartialType } from '@nestjs/swagger';
import { CreateDeviceOwnerDto } from './create-device-owner.dto';

export class UpdateDeviceOwnerDto extends PartialType(CreateDeviceOwnerDto) {}

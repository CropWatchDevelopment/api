// src/cw_device_locations/dto/update-device-location.dto.ts
import { PartialType } from '@nestjs/swagger';
import { CreateDeviceLocationDto } from './create-device-location.dto';

export class UpdateDeviceLocationDto extends PartialType(CreateDeviceLocationDto) {}

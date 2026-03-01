import { PartialType } from '@nestjs/swagger';
import { Database } from '../../../../database.types';
import { CreateAirAnnotationDto } from './create-air-annotation.dto';

type AirAnnotationUpdate =
  Database['public']['Tables']['cw_air_annotations']['Update'];

export class UpdateAirAnnotationDto
  extends PartialType(CreateAirAnnotationDto)
  implements AirAnnotationUpdate {}

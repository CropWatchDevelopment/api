import { Module } from '@nestjs/common';
import { SoilService } from './soil.service';
import { SoilController } from './soil.controller';

@Module({
  controllers: [SoilController],
  providers: [SoilService],
})
export class SoilModule {}

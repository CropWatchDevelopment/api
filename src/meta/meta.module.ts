import { Module } from '@nestjs/common';
import { MetaService } from './meta.service';
import { MetaController } from './meta.controller';

@Module({
  controllers: [MetaController],
  providers: [MetaService],
})
export class MetaModule {}

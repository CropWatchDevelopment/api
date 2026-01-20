import { Module } from '@nestjs/common';
import { TimezoneFormatterService } from './timezone-formatter.service';

@Module({
  providers: [TimezoneFormatterService],
  exports: [TimezoneFormatterService],
})
export class CommonModule {}

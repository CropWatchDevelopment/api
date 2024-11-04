import { Module } from '@nestjs/common';
import { ReportsTemplatesController } from './reports_templates.controller';
import { ReportsTemplatesService } from './reports_templates.service';
import { ReportTemplatesRepository } from 'src/repositories/reports_templates.repository';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [SupabaseModule, AuthModule],
  controllers: [ReportsTemplatesController],
  providers: [ReportsTemplatesService, ReportTemplatesRepository],
  exports: [ReportsTemplatesService],
})
export class ReportsTemplatesModule { }

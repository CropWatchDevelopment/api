import { Module } from '@nestjs/common';
import { ReportsTemplatesController } from './reports_templates.controller';
import { ReportsTemplatesService } from './reports_templates.service';
import { ReportTemplatesRepository } from '../repositories/reports_templates.repository';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SupabaseModule, AuthModule],
  controllers: [ReportsTemplatesController],
  providers: [ReportsTemplatesService, ReportTemplatesRepository],
  exports: [ReportsTemplatesService],
})
export class ReportsTemplatesModule { }

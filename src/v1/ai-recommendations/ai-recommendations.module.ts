import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { AuthzModule } from '../common/authz';
import { AiRecommendationsController } from './ai-recommendations.controller';
import { AiRecommendationsService } from './ai-recommendations.service';

@Module({
  imports: [SupabaseModule, AuthzModule],
  controllers: [AiRecommendationsController],
  providers: [AiRecommendationsService],
})
export class AiRecommendationsModule {}

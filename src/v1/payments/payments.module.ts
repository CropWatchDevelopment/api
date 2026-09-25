import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { SupabaseModule } from '../../supabase/supabase.module';
import { AuthzModule } from '../common/authz';

@Module({
  imports: [SupabaseModule, ConfigModule, AuthzModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeService],
  exports: [PaymentsService],
})
export class PaymentsModule {}

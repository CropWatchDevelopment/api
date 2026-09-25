import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from '../../supabase/supabase.module';
import { AuthzModule } from '../common/authz';
import { MailModule } from '../common/mail/mail.module';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { InvitesController } from './invites.controller';
import { MeController } from './me.controller';
import { AdminOrgsController } from './admin-orgs.controller';

@Module({
  imports: [SupabaseModule, ConfigModule, AuthzModule, MailModule],
  controllers: [
    MeController,
    OrganizationsController,
    InvitesController,
    AdminOrgsController,
  ],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}

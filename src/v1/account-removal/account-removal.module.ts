import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../common/mail/mail.module';
import { AccountRemovalController } from './account-removal.controller';
import { AccountRemovalService } from './account-removal.service';

@Module({
  imports: [ConfigModule, MailModule],
  controllers: [AccountRemovalController],
  providers: [AccountRemovalService],
})
export class AccountRemovalModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccountRemovalController } from './account-removal.controller';
import { AccountRemovalService } from './account-removal.service';

@Module({
  imports: [ConfigModule],
  controllers: [AccountRemovalController],
  providers: [AccountRemovalService],
})
export class AccountRemovalModule {}

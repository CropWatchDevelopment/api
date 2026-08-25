import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from './guards/jwt.auth.guard';
import { SupabaseStrategy } from './strategies/supabase.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseModule } from '../../supabase/supabase.module';

@Module({
  imports: [PassportModule, ConfigModule, SupabaseModule],
  providers: [JwtAuthGuard, SupabaseStrategy, AuthService],
  exports: [JwtAuthGuard],
  controllers: [AuthController],
})
export class AuthModule {}

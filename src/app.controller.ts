import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { Throttle } from '@nestjs/throttler';
import { Public } from './auth/public.decorator';

// @ApiBearerAuth('authorization')
// @UseInterceptors(CacheInterceptor)
// @CacheTTL(20)
@ApiTags('app')
@Controller()
export class AppController {
  constructor() {}

  // @UseInterceptors(CacheInterceptor)
  @Public()
  @Get('/')
  @Throttle({ default: { limit: 1, ttl: 6000 } })
  async getHello() {
    console.log('Hello World!');
    return 'Hello World!';
  }
}

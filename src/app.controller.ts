import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';

@ApiBearerAuth('authorization')
@UseInterceptors(CacheInterceptor)
@CacheTTL(20)
@Controller()
export class AppController {
  constructor() {}

  @UseInterceptors(CacheInterceptor)
  @Get()
  async getHello() {
    return [{ id: 1, name: 'Nest' + Math.random() }];
  }
}

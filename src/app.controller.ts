import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { join } from 'path';
import type { Response } from 'express';

@Controller()
export class AppController {
  @Get()
  @ApiOkResponse({
    description: 'API introduction homepage (HTML).',
    content: {
      'text/html': {
        schema: { type: 'string' },
      },
    },
  })
  getHello(@Res() res: Response) {
    return res.sendFile(join(process.cwd(), 'static', 'index.html'));
  }
}

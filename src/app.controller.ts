import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { JwtAuthGuard } from './auth/guards/jwt.auth.guard';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // @Get()
  // getHello(): string {
  //   return this.appService.getHello();
  // }

  @Get()
  @UseGuards(JwtAuthGuard)
  async protected(@Req() req) {
    console.log(req)
    return {
      "message": "AuthGuard works 🎉",
      "authenticated_user": req.user
    };
  }
}

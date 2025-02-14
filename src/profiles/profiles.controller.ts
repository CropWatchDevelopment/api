import { Controller, Get, Req } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}
  
  @Get()
  @ApiBearerAuth('JWT')
  findOne(@Req() req) {
    const id = req.headers['authorization'];
    return this.profilesService.findOne(id);
  }
}

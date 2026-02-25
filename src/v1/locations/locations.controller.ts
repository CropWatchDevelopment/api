import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { ApiBearerAuth, ApiOkResponse, ApiSecurity } from '@nestjs/swagger';
import { LocationDto } from './dto/location.dto';

@Controller({ path: 'locations', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) { }

  @Post()
  create(@Body() createLocationDto: CreateLocationDto, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.locationsService.create(createLocationDto, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Current all of the user's rules configurations.",
    type: LocationDto,
    isArray: true,
  })
  @Get()
  findAll(@Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.locationsService.findAll(req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Get a user's location configuration by ID.",
    type: LocationDto,
    isArray: false,
  })
  @Get(':id')
  findOne(@Param('id') id: number, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.locationsService.findOne(id, req.user, authHeader);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateLocationDto: UpdateLocationDto) {
    return this.locationsService.update(+id, updateLocationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.locationsService.remove(+id);
  }
}

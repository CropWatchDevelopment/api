import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from 'src/auth/guards/supabase.guard';
import { GeolocationService } from './geolocation.service';

@ApiTags('Addresses')
@Controller('geolocation')
export class GeolocationController {
    constructor(private readonly geoLocationService: GeolocationService) { }

    @ApiBearerAuth('XYZ')
    @Get('address')
    @UseGuards(SupabaseAuthGuard)
    async getProtectedRoute() {
        const location = await this.geoLocationService.getGeolocation('45 huntington ave, boston, ma');
        return { message: 'Geolocation fetched', location };
    }

}
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase.guard';
import { GeolocationService } from './geolocation.service';

@ApiTags('Addresses')
@Controller('geolocation')
export class GeolocationController {
    constructor(private readonly geoLocationService: GeolocationService) { }

    @ApiBearerAuth('JWT')
    @Get('address')
    @UseGuards(SupabaseAuthGuard)
    async getProtectedRoute() {
        const location = await this.geoLocationService.getGeolocation('Africa House, 70 Kingsway, London WC2B 6AH, United Kingdom');
        return { message: 'Geolocation fetched', location };
    }

}

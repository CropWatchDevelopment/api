import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { CreateLocationOwnerDto } from './dto/create-location-owner.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { SupabaseService } from 'src/supabase/supabase.service';
import { error } from 'console';
import { LocationDto } from './dto/location.dto';
import { getAccessToken, getUserId } from 'src/supabase/supabase-token.helper';

@Injectable()
export class LocationsService {

  constructor(
    private readonly supabaseService: SupabaseService,
  ) { }

  async create(createLocationDto: CreateLocationDto, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    createLocationDto.owner_id = userId; // Ensure the owner_id is set to the authenticated user

    const { data: locationData, error: locationError } = await client.from('cw_locations').insert({
      ...createLocationDto,
      owner_id: userId,
    }).single();

    if (locationError) {
      throw new InternalServerErrorException('Failed to create location');
    }

    const location = locationData as LocationDto;

    const locationOwnerObject: CreateLocationOwnerDto = {
      user_id: userId,
      location_id: location.location_id,
      admin_user_id: userId,
      permission_level: 1,
      is_active: true,
      description: null,
    };

    const { data: ownerData, error: ownerError } = await client.from('cw_location_owners').insert({
      ...locationOwnerObject
    }).single();

    if (ownerError) {
      throw new InternalServerErrorException('Failed to create location owner');
    }

    return locationData;
  }

  async findAll(jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('cw_locations')
      .select(`
    *,
    owner_match:cw_location_owners(),
    cw_location_owners(*)
  `)
      .eq('owner_match.user_id', userId)
      .gt('owner_match.permission_level', 4)
      .or(`owner_id.eq.${userId},owner_match.not.is.null`)
      .order('name', { ascending: true });


    if (error) {
      throw new InternalServerErrorException('Failed to fetch locations');
    }

    return data;
  }

  async findOne(id: number, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('cw_locations')
      .select(`
    *,
    owner_match:cw_location_owners(),
    cw_location_owners(*)
  `)
      .eq('location_id', id)
      .eq('owner_match.user_id', userId)
      .gt('owner_match.permission_level', 4)
      .or(`owner_id.eq.${userId},owner_match.not.is.null`)
      .order('name', { ascending: true })
      .single();


    if (error) {
      throw new InternalServerErrorException('Failed to fetch location');
    }

    return data;
  }

  update(id: number, updateLocationDto: UpdateLocationDto) {
    return `This action updates a #${id} location`;
  }

  remove(id: number) {
    return `This action removes a #${id} location`;
  }

}

import { Injectable, InternalServerErrorException, NotFoundException, NotImplementedException, UnauthorizedException } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { CreateLocationOwnerDto } from './dto/create-location-owner.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { SupabaseService } from 'src/supabase/supabase.service';
import { error } from 'console';
import { LocationDto } from './dto/location.dto';
import { getAccessToken, getUserId } from 'src/supabase/supabase-token.helper';
import { UpdateLocationOwnerDto } from './dto/update-location-owner.dto';

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
    cw_location_owners(*, profiles(id, full_name, email))
  `)
      .eq('location_id', id)
      .eq('owner_match.user_id', userId)
      .gt('owner_match.permission_level', 4)
      .or(`owner_id.eq.${userId},owner_match.not.is.null`)
      .order('name', { ascending: true })
      .maybeSingle();


    if (error) {
      throw new InternalServerErrorException('Failed to fetch location');
    }

    if (!data) {
      throw new NotFoundException('Location not found');
    }

    return data;
  }

  update(id: number, updateLocationDto: UpdateLocationDto) {
    return `This action updates a #${id} location`;
  }

  async createLocationPermission(id: number, createLocationOwnerDto: CreateLocationOwnerDto, newUserEmail: string, applyPermissionToAllDevices: boolean, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    // check if you have permission to update location permissions
    const { data: locationCurrentPermission, error: locationPermissionError } = await client
      .from('cw_locations')
      .select(`
    *,
    owner_match:cw_location_owners(),
    cw_location_owners(*, profiles(id, full_name, email))
  `)
      .eq('location_id', id)
      .eq('owner_match.user_id', userId)
      .eq('owner_match.permission_level', 1)
      .or(`owner_id.eq.${userId},owner_match.not.is.null`)
      .maybeSingle();
    if (locationPermissionError) throw new InternalServerErrorException('Failed to fetch location permissions');
    if (!locationCurrentPermission) throw new UnauthorizedException('You do not have permission to update this location');

    // If we got here, then it means we have the necessary permissions to update location permissions, so we can proceed with upserting the location owner and potentially updating device permissions as well.
    
    //First off, get UID for new user's email
    const { data: userData, error: userError } = await client
      .from('profiles')
      .select('id')
      .eq('email', newUserEmail)
      .maybeSingle();
    if (userError) throw new InternalServerErrorException('Failed to fetch user data');
    if (!userData) throw new NotFoundException('User with the provided email not found');


    // upsert user to location
    const { error: locationOwnerError } = await client
      .from('cw_location_owners')
      .upsert(
        {
          user_id: userData.id,
          permission_level: createLocationOwnerDto.permission_level,
          location_id: id,
          is_active: true, // as we are inserting for the fist time, this should always be true.
          admin_user_id: userId,
        },
        { onConflict: 'location_id,user_id' },
      )
      .single();
    if (locationOwnerError) throw new InternalServerErrorException('Failed to update location owner');

    // get All devices inside of location
    const { data: locationDevices, error: locationDevicesError } = await client
      .from('cw_devices')
      .select('dev_eui')
      .eq('location_id', id);
    if (locationDevicesError) throw new InternalServerErrorException('Failed to fetch location devices');

    const locationPermissionLevel = createLocationOwnerDto.permission_level ?? 4;

    // add check if user selected to add current permission to all location's devices
    // if true, add user's new permission level to all devices, if false, add user to devices with lowest permission level (4) to ensure they can access the devices through the location
    for (const device of locationDevices ?? []) {
      const { error: deviceOwnerError } = await client
        .from('cw_device_owners')
        .upsert(
          {
            user_id: createLocationOwnerDto.user_id,
            dev_eui: device.dev_eui,
            permission_level: applyPermissionToAllDevices ? locationPermissionLevel : 4,
          },
          { onConflict: 'dev_eui,user_id' },
        )
        .single();
      if (deviceOwnerError) throw new InternalServerErrorException('Failed to update device owner');
    }
  }

  async updateLocationPermission(id: number, updateLocationOwnerDto: UpdateLocationOwnerDto, applyPermissionToAllDevices: boolean, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    // check if you have permission to update location permissions
    const { data: locationCurrentPermission, error: locationPermissionError } = await client
      .from('cw_locations')
      .select(`
    *,
    owner_match:cw_location_owners(),
    cw_location_owners(*)
  `)
      .eq('location_id', id)
      .eq('owner_match.user_id', userId)
      .eq('owner_match.permission_level', 1)
      .or(`owner_id.eq.${userId},owner_match.not.is.null`)
      .maybeSingle();
    if (locationPermissionError) throw new InternalServerErrorException('Failed to fetch location permissions');
    if (!locationCurrentPermission) throw new UnauthorizedException('You do not have permission to update this location');

    // If we got here, then it means we have the necessary permissions to update location permissions, so we can proceed with upserting the location owner and potentially updating device permissions as well.

    // upsert user to location
    const { error: locationOwnerError } = await client
      .from('cw_location_owners')
      .upsert(
        {
          user_id: updateLocationOwnerDto.user_id,
          permission_level: updateLocationOwnerDto.permission_level,
          location_id: locationCurrentPermission.location_id,
          is_active: updateLocationOwnerDto.is_active, // as we are inserting for the fist time, this should always be true.
          admin_user_id: userId,
        },
        { onConflict: 'location_id,user_id' },
      )
      .single();
    if (locationOwnerError) throw new InternalServerErrorException('Failed to update location owner');

    // get All devices inside of location
    const { data: locationDevices, error: locationDevicesError } = await client
      .from('cw_devices')
      .select('dev_eui')
      .eq('location_id', locationCurrentPermission.location_id);
    if (locationDevicesError) throw new InternalServerErrorException('Failed to fetch location devices');

    const locationPermissionLevel = updateLocationOwnerDto.permission_level ?? 4;

    // add check if user selected to add current permission to all location's devices
    // if true, add user's new permission level to all devices, if false, add user to devices with lowest permission level (4) to ensure they can access the devices through the location
    for (const device of locationDevices ?? []) {
      const { error: deviceOwnerError } = await client
        .from('cw_device_owners')
        .upsert(
          {
            user_id: updateLocationOwnerDto.user_id,
            dev_eui: device.dev_eui,
            permission_level: applyPermissionToAllDevices ? locationPermissionLevel : 4,
          },
          { onConflict: 'dev_eui,user_id' },
        )
        .single();
      if (deviceOwnerError) throw new InternalServerErrorException('Failed to update device owner');
    }
  }

  remove(id: number) {
    throw new NotImplementedException('Location deletion is not implemented yet, Contact support if you want to delete a location.');
  }

}

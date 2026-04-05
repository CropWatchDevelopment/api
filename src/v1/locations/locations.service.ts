import { Injectable, InternalServerErrorException, NotFoundException, NotImplementedException, UnauthorizedException } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { CreateLocationOwnerDto } from './dto/create-location-owner.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { SupabaseService } from '../../supabase/supabase.service';
import { error, group } from 'console';
import { LocationDto } from './dto/location.dto';
import {
  getAccessToken,
  getUserId,
  isCropwatchStaff,
} from '../../supabase/supabase-token.helper';
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
    }).select('*')
    .single();

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
    })
    .select('*')
    .single();

    if (ownerError) {
      throw new InternalServerErrorException('Failed to create location owner');
    }

    return locationData;
  }

  async findAll(jwtPayload: any, authHeader: string, searchName?: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    let query = client
      .from('cw_locations')
      .select(`
    *,
    owner_match:cw_location_owners(),
    cw_location_owners(*)
  `);

    query = this.applyLocationReadScope(query, userId, isGlobalUser);

    if (searchName) {
      query = query.ilike('name', `%${searchName}%`);
    }

    const { data, error } = await query.order('name', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to fetch locations');
    }

    return data;
  }

  async findOne(id: number, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    let query = client
      .from('cw_locations')
      .select(`*,owner_match:cw_location_owners(),cw_location_owners(*, profiles(id, full_name, email))`)
      .eq('location_id', id);

    query = this.applyLocationReadScope(query, userId, isGlobalUser);

    const { data, error } = await query
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

  async update(id: number, updateLocationDto: UpdateLocationDto, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    // check if you have permission to update location permissions
    let permissionQuery = client
      .from('cw_locations')
      .select(`
    *,
    owner_match:cw_location_owners(),
    cw_location_owners(*, profiles(id, full_name, email))
  `)
      .eq('location_id', id);
    permissionQuery = this.applyLocationManageScope(
      permissionQuery,
      userId,
      isGlobalUser,
    );
    const { data: locationCurrentPermission, error: locationPermissionError } = await permissionQuery.maybeSingle();
    if (locationPermissionError) throw new InternalServerErrorException('Failed to fetch location permissions');
    if (!locationCurrentPermission) throw new UnauthorizedException('You do not have permission to update this location');

    let updateQuery = client
      .from('cw_locations')
      .update({
        name: updateLocationDto.name,
        group: updateLocationDto.group,
      })
      .eq('location_id', id);

    if (!isGlobalUser) {
      updateQuery = updateQuery.eq('owner_id', userId);
    }

    const { data, error } = await updateQuery
      .select('*')
      .single();

    if (error) {
      throw new InternalServerErrorException('Failed to update location');
    }

    if (!data) {
      throw new NotFoundException('Location not found or you do not have permission to update');
    }

    return data;
  }

  async findAllLocationGroups(jwtPayload: any, authHeader: string): Promise<string[]> {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    let query = client
      .from('cw_locations')
      .select('owner_match:cw_location_owners(), cw_location_owners(*), group')
      .not('group', 'is', null);

    if (!isGlobalUser) {
      query = query
        .eq('owner_id', userId)
        .eq('owner_match.user_id', userId) // Ensure we only get location groups WE are owners of
        .or(`owner_id.eq.${userId},owner_match.not.is.null`) // OR locations that we have permission to access
        .lt('owner_match.permission_level', 4); // AND we have a permission level LESS THAN 4 (enabled)
    }

    const { data, error } = await query.order('name', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to fetch location groups');
    }

    const uniqueGroupArray = Array.from(new Set(data.map(item => item.group))).filter(group => group !== null);

    return uniqueGroupArray;
  }

  async createLocationPermission(id: number, createLocationOwnerDto: CreateLocationOwnerDto, permissionLevel: number, applyPermissionToAllDevices: boolean, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    // check if you have permission to update location permissions
    let permissionQuery = client
      .from('cw_locations')
      .select(`
    *,
    owner_match:cw_location_owners(),
    cw_location_owners(*, profiles(id, full_name, email))
  `)
      .eq('location_id', id);
    permissionQuery = this.applyLocationManageScope(
      permissionQuery,
      userId,
      isGlobalUser,
    );
    const { data: locationCurrentPermission, error: locationPermissionError } = await permissionQuery.maybeSingle();
    if (locationPermissionError) throw new InternalServerErrorException('Failed to fetch location permissions');
    if (!locationCurrentPermission) throw new UnauthorizedException('You do not have permission to update this location');

    // If we got here, then it means we have the necessary permissions to update location permissions, so we can proceed with upserting the location owner and potentially updating device permissions as well.

    //First off, get UID for new user's email

    const { data: userData, error: userError } = await client
      .from('profiles')
      .select('id')
      .eq('email', createLocationOwnerDto.user_email)
      .maybeSingle();

    if (userError) throw new InternalServerErrorException('Failed to fetch user data');
    if (!userData) throw new NotFoundException('User with the provided email not found');


    // upsert user to location
    const { error: locationOwnerError } = await client
      .from('cw_location_owners')
      .upsert(
        {
          user_id: userData.id,
          permission_level: permissionLevel,
          location_id: id,
          is_active: true, // as we are inserting for the fist time, this should always be true.
          admin_user_id: userId,
        },
      )
      .single();
    if (locationOwnerError) throw new InternalServerErrorException('Failed to update location owner');

    // get All devices inside of location
    const { data: locationDevices, error: locationDevicesError } = await client
      .from('cw_devices')
      .select('dev_eui')
      .eq('location_id', id);
    if (locationDevicesError) throw new InternalServerErrorException('Failed to fetch location devices');

    const locationPermissionLevel = permissionLevel ?? 4;

    // add check if user selected to add current permission to all location's devices
    // if true, add user's new permission level to all devices, if false, add user to devices with lowest permission level (4) to ensure they can access the devices through the location
    for (const device of locationDevices ?? []) {
      const { error: deviceOwnerError } = await client
        .from('cw_device_owners')
        .upsert(
          {
            user_id: userData.id,
            dev_eui: device.dev_eui,
            permission_level: applyPermissionToAllDevices ? locationPermissionLevel : 4,
          },
          { onConflict: 'dev_eui,user_id' },
        )
        .single();
      if (deviceOwnerError) throw new InternalServerErrorException('Failed to update device owner');
    }

    return { message: 'Location permission successfully updated' };
  }

  async updateLocationPermission(id: number, updateLocationOwnerDto: UpdateLocationOwnerDto, applyPermissionToAllDevices: boolean, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    // check if you have permission to update location permissions
    let permissionQuery = client
      .from('cw_locations')
      .select(`
    *,
    owner_match:cw_location_owners(),
    cw_location_owners(*)
  `)
      .eq('location_id', id);
    permissionQuery = this.applyLocationManageScope(
      permissionQuery,
      userId,
      isGlobalUser,
    );
    const { data: locationCurrentPermission, error: locationPermissionError } = await permissionQuery.maybeSingle();
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

  async updateUserPermissionLevel(id: number, updateLocationOwnerDto: any, applyPermissionToAllDevices: boolean, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    const email = updateLocationOwnerDto.email;
    const permission_level = updateLocationOwnerDto.permission_level;
    const location_id = updateLocationOwnerDto.location_id;

    // check if you have permission to update location permissions
    let permissionQuery = client
      .from('cw_locations')
      .select(`
    *,
    owner_match:cw_location_owners(),
    cw_location_owners(*)
  `)
      .eq('location_id', id);
    permissionQuery = this.applyLocationManageScope(
      permissionQuery,
      userId,
      isGlobalUser,
    );
    const { data: locationCurrentPermission, error: locationPermissionError } = await permissionQuery.maybeSingle();
    if (locationPermissionError) throw new InternalServerErrorException('Failed to fetch location permissions');
    if (!locationCurrentPermission) throw new UnauthorizedException('You do not have permission to update this location');

    // If we got here, then it means we have the necessary permissions to update location permissions, so we can proceed with upserting the location owner and potentially updating device permissions as well.
    const { data: userData, error: userError } = await client
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (userError) throw new InternalServerErrorException('Failed to fetch user data');
    if (!userData) throw new NotFoundException('User with the provided email not found');

    // upsert user to location
    const { error: locationOwnerError } = await client
      .from('cw_location_owners')
      .update(
        {
          user_id: userData.id,
          permission_level: permission_level,
          location_id: location_id,
          is_active: true, // as we are inserting for the fist time, this should always be true.
        })
      .eq('location_id', location_id)
      .eq('user_id', userData.id)
      .single();
    if (locationOwnerError) throw new InternalServerErrorException('Failed to update location owner');

    return { message: 'Location permission level successfully updated' };
  }

  async removeLocationPermission(location_id: number, permissionId: number, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    // Check if current user has permissions to remove another user's permissions from the location
    let permissionQuery = client
      .from('cw_locations')
      .select(`
    *,
    owner_match:cw_location_owners(),
    cw_location_owners(*)
  `)
      .eq('location_id', location_id);
    permissionQuery = this.applyLocationManageScope(
      permissionQuery,
      userId,
      isGlobalUser,
    );
    const { data: requestingUser, error } = await permissionQuery.maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to fetch location permissions');
    }
    if (!requestingUser) {
      throw new UnauthorizedException('You do not have permission to update this location');
    }


    // GET THE ROW WITH THE ACTUAL USER ID THAT WE WILL DELETE EVERYWHERE LATER ON
    const { data: locationPermissionRecord, error: locationPermissionRecordError } = await client
      .from('cw_location_owners')
      .select('*')
      .eq('id', permissionId)
      .eq('location_id', location_id)
      .maybeSingle();
    if (locationPermissionRecordError) throw new InternalServerErrorException('Failed to fetch location permission record');
    if (!locationPermissionRecord) throw new NotFoundException('Location permission record not found');

    const user_id_to_delete = locationPermissionRecord.user_id;

    // delete location permission
    const { error: deleteLocationPermissionError } = await client
      .from('cw_location_owners')
      .delete()
      .eq('id', permissionId)
      .eq('location_id', location_id);
    if (deleteLocationPermissionError) throw new InternalServerErrorException('Failed to delete location permission');

    // get All devices inside of location
    const { data: locationDevices, error: locationDevicesError } = await client
      .from('cw_devices')
      .select('dev_eui')
      .eq('location_id', location_id);
    if (locationDevicesError) throw new InternalServerErrorException('Failed to fetch location devices');

    // delete user's permissions from all devices in the location
    for (const device of locationDevices ?? []) {
      const { error: deleteDevicePermissionError } = await client
        .from('cw_device_owners')
        .delete()
        .eq('user_id', user_id_to_delete)
        .eq('dev_eui', device.dev_eui);
      if (deleteDevicePermissionError) throw new InternalServerErrorException('Failed to delete device permission');
    }

    return { message: 'Location permission and associated device permissions successfully deleted' };

  }

  private applyLocationReadScope(query: any, userId: string, isGlobalUser: boolean) {
    if (isGlobalUser) {
      return query;
    }

    return query
      .eq('owner_match.user_id', userId)
      .lt('owner_match.permission_level', 4)
      .or(`owner_id.eq.${userId},owner_match.not.is.null`);
  }

  private applyLocationManageScope(query: any, userId: string, isGlobalUser: boolean) {
    if (isGlobalUser) {
      return query;
    }

    return query
      .eq('owner_match.user_id', userId)
      .lte('owner_match.permission_level', 2)
      .or(`owner_id.eq.${userId},owner_match.not.is.null`);
  }

}

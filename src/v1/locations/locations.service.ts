import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { CreateLocationDto } from './dto/create-location.dto';
import { CreateLocationOwnerDto } from './dto/create-location-owner.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateLocationUserPermissionLevelDto } from './dto/update-location-user-permission-level.dto';
import { SupabaseService } from '../../supabase/supabase.service';
import { LocationDto } from './dto/location.dto';
import { UpdateLocationOwnerDto } from './dto/update-location-owner.dto';
import { PermissionLevel } from '../common/permission-levels';
import { filterStaffOwnerRows } from '../common/owner-filter.helper';
import {
  AccessService,
  Action,
  LOCATION_OWNER_MATCH_EMBED,
  applyLocationReadScope,
  assertCanGrant,
  type LocationAccess,
} from '../common/authz';
import type { TableRow } from '../types/supabase';
import type { AuthenticatedUser } from '../auth/authenticated-user';

type LocationRow = TableRow<'cw_locations'>;
type LocationOwnerRow = TableRow<'cw_location_owners'>;
type OwnerProfile = Pick<TableRow<'profiles'>, 'id' | 'full_name' | 'email'>;
type LocationOwnerWithProfile = LocationOwnerRow & {
  profiles?: OwnerProfile | OwnerProfile[] | null;
};
type LocationRecord = LocationRow & {
  cw_location_owners: LocationOwnerWithProfile[];
};
type QueryResult<T> = { data: T | null; error: PostgrestError | null };

@Injectable()
export class LocationsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
  ) {}

  async create(createLocationDto: CreateLocationDto, user: AuthenticatedUser) {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    createLocationDto.owner_id = userId; // Ensure the owner_id is set to the authenticated user

    const { data: locationData, error: locationError } = (await client
      .from('cw_locations')
      .insert({
        ...createLocationDto,
        owner_id: userId,
      })
      .select('*')
      .single()) as QueryResult<LocationRow>;

    if (locationError) {
      throw new InternalServerErrorException('Failed to create location');
    }

    const location = locationData as LocationDto;

    const locationOwnerObject: CreateLocationOwnerDto = {
      user_id: userId,
      location_id: location.location_id,
      admin_user_id: userId,
      permission_level: PermissionLevel.ADMIN,
      is_active: true,
      description: null,
    };

    const { error: ownerError } = await client
      .from('cw_location_owners')
      .insert({
        ...locationOwnerObject,
      })
      .select('*')
      .single();

    if (ownerError) {
      throw new InternalServerErrorException('Failed to create location owner');
    }

    return locationData;
  }

  async findAll(user: AuthenticatedUser, searchName?: string) {
    const client = this.supabaseService.getClient();

    let query = client.from('cw_locations').select(`
    *,
    ${LOCATION_OWNER_MATCH_EMBED},
    cw_location_owners(*)
  `);

    query = applyLocationReadScope(
      query,
      user,
      await this.accessService.getReadableOrgIds(user),
    );

    if (searchName) {
      query = query.ilike('name', `%${searchName}%`);
    }

    const { data, error } = await query.order('name', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to fetch locations');
    }

    return (data ?? []) as LocationRecord[];
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const client = this.supabaseService.getClient();
    const isGlobalUser = user.isStaff;

    let query = client
      .from('cw_locations')
      .select(
        `*,${LOCATION_OWNER_MATCH_EMBED},cw_location_owners(*, profiles(id, full_name, email))`,
      )
      .eq('location_id', id);

    query = applyLocationReadScope(
      query,
      user,
      await this.accessService.getReadableOrgIds(user),
    );

    const { data, error } = (await query
      .order('name', { ascending: true })
      .maybeSingle()) as QueryResult<LocationRecord>;

    if (error) {
      throw new InternalServerErrorException('Failed to fetch location');
    }

    if (!data) {
      throw new NotFoundException('Location not found');
    }

    return {
      ...data,
      cw_location_owners: filterStaffOwnerRows(
        data.cw_location_owners,
        isGlobalUser,
      ),
    };
  }

  async update(
    id: number,
    updateLocationDto: UpdateLocationDto,
    user: AuthenticatedUser,
  ) {
    const client = this.supabaseService.getClient();

    // 404 when invisible, 403 when visible but below Manager.
    await this.accessService.assertLocationAccess(
      user,
      id,
      Action.LocationEdit,
    );

    // The permission gate above is the authorization boundary; the update
    // itself only filters by primary key. (Previously this re-filtered on
    // owner_id, which made Managers pass the gate and then 500.)
    const { data, error } = (await client
      .from('cw_locations')
      .update({
        name: updateLocationDto.name,
        group: updateLocationDto.group,
      })
      .eq('location_id', id)
      .select('*')
      .maybeSingle()) as QueryResult<LocationRow>;

    if (error) {
      throw new InternalServerErrorException('Failed to update location');
    }

    if (!data) {
      throw new NotFoundException('Location not found');
    }

    return data;
  }

  async findAllLocationGroups(user: AuthenticatedUser): Promise<string[]> {
    const client = this.supabaseService.getClient();

    let query = client
      .from('cw_locations')
      .select(`${LOCATION_OWNER_MATCH_EMBED}, group`)
      .not('group', 'is', null);

    // Shared read scope: owned OR granted below Disabled. (Previously this
    // had an extra owner_id filter that hid every shared location's group.)
    query = applyLocationReadScope(
      query,
      user,
      await this.accessService.getReadableOrgIds(user),
    );

    const { data, error } = await query.order('name', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to fetch location groups');
    }

    const rows = (data ?? []) as Pick<LocationRow, 'group'>[];
    const uniqueGroupArray = Array.from(
      new Set(rows.map((item) => item.group)),
    ).filter((group) => group !== null);

    return uniqueGroupArray;
  }

  async createLocationPermission(
    id: number,
    createLocationOwnerDto: CreateLocationOwnerDto,
    permissionLevel: number,
    applyPermissionToAllDevices: boolean,
    user: AuthenticatedUser,
  ) {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const access = await this.accessService.assertLocationAccess(
      user,
      id,
      Action.LocationGrant,
    );

    // Resolve the target user's id from their email.
    const { data: userData, error: userError } = await client
      .from('profiles')
      .select('id')
      .eq('email', createLocationOwnerDto.user_email)
      .maybeSingle();

    if (userError)
      throw new InternalServerErrorException('Failed to fetch user data');
    if (!userData)
      throw new NotFoundException('User with the provided email not found');

    await this.assertLocationGrantAllowed(user, access, userData.id, {
      newLevel: permissionLevel,
    });

    // upsert user to location
    const { error: locationOwnerError } = await client
      .from('cw_location_owners')
      .upsert({
        user_id: userData.id,
        permission_level: permissionLevel,
        location_id: id,
        is_active: true, // as we are inserting for the fist time, this should always be true.
        admin_user_id: userId,
      })
      .single();
    if (locationOwnerError)
      throw new InternalServerErrorException('Failed to update location owner');

    // get All devices inside of location
    const { data: locationDevices, error: locationDevicesError } = await client
      .from('cw_devices')
      .select('dev_eui')
      .eq('location_id', id);
    if (locationDevicesError)
      throw new InternalServerErrorException(
        'Failed to fetch location devices',
      );

    const locationPermissionLevel = permissionLevel ?? PermissionLevel.DISABLED;

    // add check if user selected to add current permission to all location's devices
    // if true, add user's new permission level to all devices, if false, add user to devices as Disabled so they can access the location without seeing its devices
    for (const device of locationDevices ?? []) {
      const { error: deviceOwnerError } = await client
        .from('cw_device_owners')
        .upsert(
          {
            user_id: userData.id,
            dev_eui: device.dev_eui,
            permission_level: applyPermissionToAllDevices
              ? locationPermissionLevel
              : PermissionLevel.DISABLED,
          },
          { onConflict: 'dev_eui,user_id' },
        )
        .single();
      if (deviceOwnerError)
        throw new InternalServerErrorException('Failed to update device owner');
    }

    return { message: 'Location permission successfully updated' };
  }

  async updateLocationPermission(
    id: number,
    updateLocationOwnerDto: UpdateLocationOwnerDto,
    applyPermissionToAllDevices: boolean,
    user: AuthenticatedUser,
  ) {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const access = await this.accessService.assertLocationAccess(
      user,
      id,
      Action.LocationGrant,
    );

    const targetUserId = updateLocationOwnerDto.user_id;
    if (!targetUserId) {
      throw new NotFoundException('User not found');
    }

    await this.assertLocationGrantAllowed(user, access, targetUserId, {
      newLevel: updateLocationOwnerDto.permission_level ?? undefined,
    });

    // upsert user to location — always against the route's location id.
    const { error: locationOwnerError } = await client
      .from('cw_location_owners')
      .upsert(
        {
          user_id: targetUserId,
          permission_level: updateLocationOwnerDto.permission_level,
          location_id: id,
          is_active: updateLocationOwnerDto.is_active, // as we are inserting for the fist time, this should always be true.
          admin_user_id: userId,
        },
        { onConflict: 'location_id,user_id' },
      )
      .single();
    if (locationOwnerError)
      throw new InternalServerErrorException('Failed to update location owner');

    // get All devices inside of location
    const { data: locationDevices, error: locationDevicesError } = await client
      .from('cw_devices')
      .select('dev_eui')
      .eq('location_id', id);
    if (locationDevicesError)
      throw new InternalServerErrorException(
        'Failed to fetch location devices',
      );

    const locationPermissionLevel =
      updateLocationOwnerDto.permission_level ?? PermissionLevel.DISABLED;

    // add check if user selected to add current permission to all location's devices
    // if true, add user's new permission level to all devices, if false, add user to devices as Disabled so they can access the location without seeing its devices
    for (const device of locationDevices ?? []) {
      const { error: deviceOwnerError } = await client
        .from('cw_device_owners')
        .upsert(
          {
            user_id: targetUserId,
            dev_eui: device.dev_eui,
            permission_level: applyPermissionToAllDevices
              ? locationPermissionLevel
              : PermissionLevel.DISABLED,
          },
          { onConflict: 'dev_eui,user_id' },
        )
        .single();
      if (deviceOwnerError)
        throw new InternalServerErrorException('Failed to update device owner');
    }
  }

  async updateUserPermissionLevel(
    id: number,
    updateLocationOwnerDto: UpdateLocationUserPermissionLevelDto,
    applyPermissionToAllDevices: boolean,
    user: AuthenticatedUser,
  ) {
    const client = this.supabaseService.getClient();

    const { email, permission_level } = updateLocationOwnerDto;

    const access = await this.accessService.assertLocationAccess(
      user,
      id,
      Action.LocationGrant,
    );

    const { data: userData, error: userError } = await client
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (userError)
      throw new InternalServerErrorException('Failed to fetch user data');
    if (!userData)
      throw new NotFoundException('User with the provided email not found');

    await this.assertLocationGrantAllowed(user, access, userData.id, {
      newLevel: permission_level,
    });

    // Update the existing row — always at the route's location id. (This
    // previously wrote to a location_id taken from the request body, which
    // allowed cross-location permission escalation.)
    const { error: locationOwnerError } = await client
      .from('cw_location_owners')
      .update({
        permission_level: permission_level,
        is_active: true,
      })
      .eq('location_id', id)
      .eq('user_id', userData.id)
      .single();
    if (locationOwnerError)
      throw new InternalServerErrorException('Failed to update location owner');

    return { message: 'Location permission level successfully updated' };
  }

  async removeLocationPermission(
    location_id: number,
    permissionId: number,
    user: AuthenticatedUser,
  ) {
    const client = this.supabaseService.getClient();

    const access = await this.accessService.assertLocationAccess(
      user,
      location_id,
      Action.LocationGrant,
    );

    // GET THE ROW WITH THE ACTUAL USER ID THAT WE WILL DELETE EVERYWHERE LATER ON
    const {
      data: locationPermissionRecord,
      error: locationPermissionRecordError,
    } = (await client
      .from('cw_location_owners')
      .select('*')
      .eq('id', permissionId)
      .eq('location_id', location_id)
      .maybeSingle()) as QueryResult<LocationOwnerRow>;
    if (locationPermissionRecordError)
      throw new InternalServerErrorException(
        'Failed to fetch location permission record',
      );
    if (!locationPermissionRecord)
      throw new NotFoundException('Location permission record not found');

    const user_id_to_delete = locationPermissionRecord.user_id;

    assertCanGrant({
      actor: {
        isStaff: user.isStaff,
        isOwner: access.isOwner,
        level: access.level,
      },
      target: {
        isResourceOwner:
          access.ownerId != null && user_id_to_delete === access.ownerId,
        isSelf: user_id_to_delete === user.sub,
        currentLevel: locationPermissionRecord.permission_level,
      },
      // no newLevel: removal
    });

    // delete location permission
    const { error: deleteLocationPermissionError } = await client
      .from('cw_location_owners')
      .delete()
      .eq('id', permissionId)
      .eq('location_id', location_id);
    if (deleteLocationPermissionError)
      throw new InternalServerErrorException(
        'Failed to delete location permission',
      );

    // get All devices inside of location
    const { data: locationDevices, error: locationDevicesError } = await client
      .from('cw_devices')
      .select('dev_eui')
      .eq('location_id', location_id);
    if (locationDevicesError)
      throw new InternalServerErrorException(
        'Failed to fetch location devices',
      );

    // delete user's permissions from all devices in the location
    for (const device of locationDevices ?? []) {
      const { error: deleteDevicePermissionError } = await client
        .from('cw_device_owners')
        .delete()
        .eq('user_id', user_id_to_delete)
        .eq('dev_eui', device.dev_eui);
      if (deleteDevicePermissionError)
        throw new InternalServerErrorException(
          'Failed to delete device permission',
        );
    }

    return {
      message:
        'Location permission and associated device permissions successfully deleted',
    };
  }

  /**
   * Grant-ceiling check for changing `targetUserId`'s access on the
   * location: fetches the target's current row and delegates to the pure
   * `assertCanGrant` policy.
   */
  private async assertLocationGrantAllowed(
    user: AuthenticatedUser,
    access: LocationAccess,
    targetUserId: string,
    options: { newLevel?: number },
  ): Promise<void> {
    const client = this.supabaseService.getClient();

    const { data: currentRow, error } = (await client
      .from('cw_location_owners')
      .select('permission_level')
      .eq('location_id', access.locationId)
      .eq('user_id', targetUserId)
      .maybeSingle()) as QueryResult<
      Pick<LocationOwnerRow, 'permission_level'>
    >;

    if (error) {
      throw new InternalServerErrorException(
        'Failed to fetch location permissions',
      );
    }

    assertCanGrant({
      actor: {
        isStaff: user.isStaff,
        isOwner: access.isOwner,
        level: access.level,
      },
      target: {
        isResourceOwner:
          access.ownerId != null && targetUserId === access.ownerId,
        isSelf: targetUserId === user.sub,
        currentLevel: currentRow?.permission_level ?? null,
      },
      newLevel: options.newLevel,
    });
  }
}

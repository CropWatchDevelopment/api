import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { AuthzModule } from '../common/authz';
import {
  DeviceGroupsController,
  LocationGroupsController,
} from './groups.controller';
import { GroupsService } from './groups.service';

/**
 * Device and location groups: /v1/location-groups, /v1/device-groups, and
 * GroupsService, which the device and location services use to turn the
 * `group` names they receive into group ids.
 */
@Module({
  imports: [SupabaseModule, AuthzModule],
  controllers: [LocationGroupsController, DeviceGroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}

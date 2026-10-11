import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { LocationsService } from '../locations/locations.service';
import { PaymentsModule } from '../payments/payments.module';
import { AuthzModule } from '../common/authz';
import { TtiProvisioningService } from '../tti/tti-provisioning.service';
import { DeviceSetupController } from './setup/device-setup.controller';
import { DeviceSetupService } from './setup/device-setup.service';

@Module({
  // DevicesModule declares its own LocationsService instance, so it must also
  // import PaymentsModule (LocationsService depends on PaymentsService for the
  // base-subscription gate on location creation).
  imports: [SupabaseModule, PaymentsModule, AuthzModule],
  controllers: [DevicesController, DeviceSetupController],
  providers: [
    DevicesService,
    LocationsService,
    DeviceSetupService,
    TtiProvisioningService,
  ],
  exports: [DevicesService],
})
export class DevicesModule {}

import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/guards/jwt.auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import { DeviceSetupService } from './device-setup.service';
import { DeviceSetupDto, DeviceSetupLookupDto } from './device-setup.dto';

/**
 * Guided device setup. Separate from /devices so `setup` never collides with
 * the `/devices/:dev_eui` routes.
 */
@Controller({ path: 'device-setup', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@UseGuards(JwtAuthGuard)
export class DeviceSetupController {
  constructor(private readonly deviceSetupService: DeviceSetupService) {}

  @Post('lookup')
  @HttpCode(200)
  // Bounds DevEUI probing; generous enough for staff installing a batch.
  // blockDuration = ttl, or the counter would reset after the module's 30 s.
  @Throttle({
    default: { ttl: 3_600_000, limit: 150, blockDuration: 3_600_000 },
  })
  @ApiOperation({
    summary: 'Check a DevEUI before setup',
    description: `
    Reports whether the DevEUI is free, already yours, or another account's;
    the likely model; whether the join keys are on file or already on the
    network; and which device types the location's network region supports.
    `,
  })
  lookup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DeviceSetupLookupDto,
  ) {
    return this.deviceSetupService.lookup(user, body);
  }

  @Post()
  // Each setup makes several TTI calls with the shared provisioning key.
  @Throttle({
    default: { ttl: 3_600_000, limit: 60, blockDuration: 3_600_000 },
  })
  @ApiOperation({
    summary: 'Set up a device',
    description: `
    Registers the device on the LoRaWAN network (or adopts an existing
    registration), saves it in the location and consumes the license.
    Errors carry a machine-readable \`code\` and a support \`reference\`.
    Repeating a completed setup with the same name and location succeeds.
    `,
  })
  setup(@CurrentUser() user: AuthenticatedUser, @Body() body: DeviceSetupDto) {
    return this.deviceSetupService.setup(user, body);
  }
}

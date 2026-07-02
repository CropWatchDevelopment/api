import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiSecurity,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { PaymentsService } from './payments.service';
import { CreateBaseCheckoutDto } from './dto/create-base-checkout.dto';
import { CreateDeviceCheckoutDto } from './dto/create-device-checkout.dto';
import { ChangeSeatsDto } from './dto/change-seats.dto';
import { AssignLicenseDto } from './dto/assign-license.dto';
import { MoveLicenseDto } from './dto/move-license.dto';
import { CancelBaseDto } from './dto/cancel-base.dto';

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('products')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List the base and device subscription products' })
  getProducts() {
    return this.paymentsService.getProducts();
  }

  @Get('subscriptions/state')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get the full billing overview (base sub, device seats, licenses)',
  })
  getState(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.getState(user);
  }

  @Get('licenses')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List the user's device licenses" })
  getLicenses(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.getLicenses(user);
  }

  @Post('subscriptions/base/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create a hosted checkout for the base subscription',
  })
  createBaseCheckout(
    @Body() dto: CreateBaseCheckoutDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.createBaseCheckout(
      user,
      dto.discountId ?? null,
    );
  }

  @Post('subscriptions/device/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create a hosted checkout for device licenses (seats)',
  })
  createDeviceCheckout(
    @Body() dto: CreateDeviceCheckoutDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.createDeviceCheckout(user, dto.quantity);
  }

  @Patch('subscriptions/device/seats')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Change the number of device licenses (seats)' })
  changeDeviceSeats(
    @Body() dto: ChangeSeatsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.changeDeviceSeats(user, dto.seats);
  }

  @Post('licenses/:id/assign')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'id', description: 'License id', type: Number })
  @ApiOperation({ summary: 'Assign a license to a device' })
  assignLicense(
    @Param('id') id: string,
    @Body() dto: AssignLicenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.assignLicense(
      user,
      this.parseId(id),
      dto.devEui,
    );
  }

  @Patch('licenses/:id/move')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'id', description: 'License id', type: Number })
  @ApiOperation({ summary: 'Move a license to a different device' })
  moveLicense(
    @Param('id') id: string,
    @Body() dto: MoveLicenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.moveLicense(user, this.parseId(id), dto.devEui);
  }

  @Post('licenses/:id/unassign')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'id', description: 'License id', type: Number })
  @ApiOperation({ summary: 'Unassign a license from its device' })
  unassignLicense(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.unassignLicense(user, this.parseId(id));
  }

  @Post('licenses/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'id', description: 'License id', type: Number })
  @ApiOperation({
    summary: 'Cancel an unassigned license (reduce the paid seat count by one)',
  })
  cancelLicense(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.cancelLicense(user, this.parseId(id));
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Open the Polar customer billing portal' })
  openPortal(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.openPortal(user);
  }

  @Delete('subscriptions/base')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cancel the base subscription' })
  cancelBase(
    @Body() dto: CancelBaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.cancelBaseSubscription(
      user,
      dto.atPeriodEnd ?? true,
    );
  }

  @Post('webhook')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Receive Polar webhook events (signature-verified)',
  })
  handleWebhook(@Req() req: RawBodyRequest<Request>) {
    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing webhook body');
    }
    return this.paymentsService.handleWebhook(
      rawBody,
      this.normalizeHeaders(req.headers),
    );
  }

  private parseId(id: string): number {
    const parsed = Number.parseInt(id, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException('License id must be a positive integer');
    }
    return parsed;
  }

  private normalizeHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        normalized[key] = value[0] ?? '';
      } else if (typeof value === 'string') {
        normalized[key] = value;
      }
    }
    return normalized;
  }
}

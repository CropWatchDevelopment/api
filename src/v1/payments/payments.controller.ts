import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { StaffGuard } from '../auth/guards/staff.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { PaymentsService } from './payments.service';
import { CreateDeviceCheckoutDto } from './dto/create-device-checkout.dto';
import { ChangeSeatsDto } from './dto/change-seats.dto';
import { AssignLicenseDto } from './dto/assign-license.dto';
import { MoveLicenseDto } from './dto/move-license.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { AdminSetBillingModeDto } from './dto/admin-set-billing-mode.dto';
import { AdminSetManualSeatsDto } from './dto/admin-set-manual-seats.dto';
import { AdminSetReportingDto } from './dto/admin-set-reporting.dto';

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  @Get('products')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List the device-seat and reporting subscription products',
  })
  getProducts() {
    return this.paymentsService.getProducts();
  }

  @Get('subscriptions/state')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Get the full billing overview (billing mode, device seats, reporting, licenses)',
  })
  getState(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.getState(user);
  }

  @Get('entitlements')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Cheap entitlement summary (seat count, reporting access) without calling Stripe',
  })
  getEntitlements(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.getEntitlements(user);
  }

  @Get('licenses')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List the user's device licenses" })
  getLicenses(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.getLicenses(user);
  }

  // ---------------------------------------------------------------------------
  // Device seats
  // ---------------------------------------------------------------------------

  @Post('subscriptions/device/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create a hosted checkout for device licenses (seats, min 3)',
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

  @Delete('subscriptions/device')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Cancel the device subscription (all seats)',
  })
  cancelDeviceSubscription(
    @Body() dto: CancelSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.cancelDeviceSubscription(
      user,
      dto.atPeriodEnd ?? true,
    );
  }

  // ---------------------------------------------------------------------------
  // Reporting add-on
  // ---------------------------------------------------------------------------

  @Post('subscriptions/reporting/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create a hosted checkout for the reporting add-on',
  })
  createReportingCheckout(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.createReportingCheckout(user);
  }

  @Delete('subscriptions/reporting')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cancel the reporting add-on subscription' })
  cancelReportingSubscription(
    @Body() dto: CancelSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.cancelReportingSubscription(
      user,
      dto.atPeriodEnd ?? true,
    );
  }

  // ---------------------------------------------------------------------------
  // Licenses
  // ---------------------------------------------------------------------------

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
    summary:
      'Cancel an unassigned license (reduce the paid seat count by one, never below the minimum)',
  })
  cancelLicense(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.cancelLicense(user, this.parseId(id));
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Open the Stripe customer billing portal' })
  openPortal(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.openPortal(user);
  }

  // ---------------------------------------------------------------------------
  // Staff administration (manual-invoice customers, legacy device visibility)
  // ---------------------------------------------------------------------------

  @Get('admin/customers')
  @UseGuards(JwtAuthGuard, StaffGuard)
  @ApiOperation({
    summary:
      'Staff: list every device owner / billing customer with device, license, and subscription counts',
  })
  adminListCustomers() {
    return this.paymentsService.adminListCustomers();
  }

  @Patch('admin/customers/:userId/billing-mode')
  @UseGuards(JwtAuthGuard, StaffGuard)
  @ApiParam({ name: 'userId', description: 'Profile id (uuid)' })
  @ApiOperation({ summary: "Staff: switch a customer's billing mode" })
  adminSetBillingMode(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: AdminSetBillingModeDto,
  ) {
    return this.paymentsService.adminSetBillingMode(userId, dto.billingMode);
  }

  @Put('admin/customers/:userId/manual-seats')
  @UseGuards(JwtAuthGuard, StaffGuard)
  @ApiParam({ name: 'userId', description: 'Profile id (uuid)' })
  @ApiOperation({
    summary:
      'Staff: set the number of staff-granted device licenses for a manual-invoice customer',
  })
  adminSetManualSeats(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: AdminSetManualSeatsDto,
  ) {
    return this.paymentsService.adminSetManualSeats(userId, dto.seats);
  }

  @Patch('admin/customers/:userId/reporting')
  @UseGuards(JwtAuthGuard, StaffGuard)
  @ApiParam({ name: 'userId', description: 'Profile id (uuid)' })
  @ApiOperation({
    summary: 'Staff: grant or revoke the reporting entitlement for a customer',
  })
  adminSetReportingManual(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: AdminSetReportingDto,
  ) {
    return this.paymentsService.adminSetReportingManual(userId, dto.manual);
  }

  // ---------------------------------------------------------------------------
  // Webhook
  // ---------------------------------------------------------------------------

  // Signature-verified in the service and driven by Stripe's own retrying
  // delivery from a small set of provider IPs — exempt from the per-user/IP
  // throttler so a retry burst can't get billing events dropped with a 429.
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Receive Stripe webhook events (signature-verified)',
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

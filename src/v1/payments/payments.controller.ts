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
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
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
  getState(@Req() req) {
    return this.paymentsService.getState(req.user, req.headers?.authorization ?? '');
  }

  @Get('licenses')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List the user's device licenses" })
  getLicenses(@Req() req) {
    return this.paymentsService.getLicenses(req.user, req.headers?.authorization ?? '');
  }

  @Post('subscriptions/base/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a hosted checkout for the base subscription' })
  createBaseCheckout(@Body() dto: CreateBaseCheckoutDto, @Req() req) {
    return this.paymentsService.createBaseCheckout(
      req.user,
      req.headers?.authorization ?? '',
      dto.discountId ?? null,
    );
  }

  @Post('subscriptions/device/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a hosted checkout for device licenses (seats)' })
  createDeviceCheckout(@Body() dto: CreateDeviceCheckoutDto, @Req() req) {
    return this.paymentsService.createDeviceCheckout(
      req.user,
      req.headers?.authorization ?? '',
      dto.quantity,
    );
  }

  @Patch('subscriptions/device/seats')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Change the number of device licenses (seats)' })
  changeDeviceSeats(@Body() dto: ChangeSeatsDto, @Req() req) {
    return this.paymentsService.changeDeviceSeats(
      req.user,
      req.headers?.authorization ?? '',
      dto.seats,
    );
  }

  @Post('licenses/:id/assign')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'id', description: 'License id', type: Number })
  @ApiOperation({ summary: 'Assign a license to a device' })
  assignLicense(@Param('id') id: string, @Body() dto: AssignLicenseDto, @Req() req) {
    return this.paymentsService.assignLicense(
      req.user,
      req.headers?.authorization ?? '',
      this.parseId(id),
      dto.devEui,
    );
  }

  @Patch('licenses/:id/move')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'id', description: 'License id', type: Number })
  @ApiOperation({ summary: 'Move a license to a different device' })
  moveLicense(@Param('id') id: string, @Body() dto: MoveLicenseDto, @Req() req) {
    return this.paymentsService.moveLicense(
      req.user,
      req.headers?.authorization ?? '',
      this.parseId(id),
      dto.devEui,
    );
  }

  @Post('licenses/:id/unassign')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'id', description: 'License id', type: Number })
  @ApiOperation({ summary: 'Unassign a license from its device' })
  unassignLicense(@Param('id') id: string, @Req() req) {
    return this.paymentsService.unassignLicense(
      req.user,
      req.headers?.authorization ?? '',
      this.parseId(id),
    );
  }

  @Post('licenses/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'id', description: 'License id', type: Number })
  @ApiOperation({ summary: 'Cancel an unassigned license (reduce the paid seat count by one)' })
  cancelLicense(@Param('id') id: string, @Req() req) {
    return this.paymentsService.cancelLicense(
      req.user,
      req.headers?.authorization ?? '',
      this.parseId(id),
    );
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Open the Polar customer billing portal' })
  openPortal(@Req() req) {
    return this.paymentsService.openPortal(req.user, req.headers?.authorization ?? '');
  }

  @Delete('subscriptions/base')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cancel the base subscription' })
  cancelBase(@Body() dto: CancelBaseDto, @Req() req) {
    return this.paymentsService.cancelBaseSubscription(
      req.user,
      req.headers?.authorization ?? '',
      dto.atPeriodEnd ?? true,
    );
  }

  @Post('webhook')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Receive Polar webhook events (signature-verified)' })
  handleWebhook(@Req() req) {
    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing webhook body');
    }
    return this.paymentsService.handleWebhook(rawBody, this.normalizeHeaders(req.headers));
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

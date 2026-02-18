import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { PaymentsService } from './payments.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { CreateCustomerPortalSessionDto } from './dto/create-customer-portal-session.dto';

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create Polar checkout session',
    description:
      'Creates a hosted Polar checkout session for the authenticated user subscriptions.',
  })
  @ApiBody({ type: CreateCheckoutSessionDto })
  @ApiOkResponse({
    description: 'Checkout session created successfully.',
    type: Object,
  })
  @Post('subscriptions/checkout')
  createCheckoutSession(@Body() createCheckoutSessionDto: CreateCheckoutSessionDto, @Req() req) {
    return this.paymentsService.createCheckoutSession(createCheckoutSessionDto, req.user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List subscriptions',
    description: 'Returns subscriptions associated with the authenticated user.',
  })
  @ApiOkResponse({
    description: 'Subscriptions fetched successfully.',
    type: Object,
  })
  @Get('subscriptions')
  listSubscriptions(@Req() req) {
    return this.paymentsService.listSubscriptions(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List Polar products',
    description: 'Returns products available in the connected Polar organization.',
  })
  @ApiOkResponse({
    description: 'Products fetched successfully.',
    type: Object,
  })
  @Get('products')
  listProducts() {
    return this.paymentsService.listProducts();
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get customer subscription state',
    description: 'Returns subscription state for the authenticated user.',
  })
  @ApiOkResponse({
    description: 'Customer state fetched successfully.',
    type: Object,
  })
  @Get('subscriptions/state')
  getCustomerState(@Req() req) {
    return this.paymentsService.getCustomerState(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create customer portal session',
    description: 'Creates a session URL for managing subscriptions in Polar customer portal.',
  })
  @ApiBody({ type: CreateCustomerPortalSessionDto })
  @ApiOkResponse({
    description: 'Customer portal session created successfully.',
    type: Object,
  })
  @Post('subscriptions/portal')
  createCustomerPortalSession(
    @Body() createCustomerPortalSessionDto: CreateCustomerPortalSessionDto,
    @Req() req,
  ) {
    return this.paymentsService.createCustomerPortalSession(
      createCustomerPortalSessionDto,
      req.user,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Cancel subscription',
    description: 'Cancels (revokes) a subscription that belongs to the authenticated user.',
  })
  @ApiParam({ name: 'id', description: 'Polar subscription ID' })
  @ApiOkResponse({
    description: 'Subscription cancelled successfully.',
    type: Object,
  })
  @Delete('subscriptions/:id')
  revokeSubscription(@Param('id') id: string, @Req() req) {
    return this.paymentsService.revokeSubscription(id, req.user);
  }
}

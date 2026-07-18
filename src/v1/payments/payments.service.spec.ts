import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentsService } from './payments.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { StripeService, BillingSubscriptionInfo } from './stripe.service';

const BASE_PRICE = 'price_base';
const DEVICE_PRICE = 'price_device';

describe('PaymentsService', () => {
  type QueryResult = { data: unknown; error: unknown };

  type QueryBuilder = {
    data: unknown;
    error: unknown;
    select: jest.Mock;
    eq: jest.Mock;
    neq: jest.Mock;
    in: jest.Mock;
    is: jest.Mock;
    or: jest.Mock;
    lte: jest.Mock;
    order: jest.Mock;
    maybeSingle: jest.Mock;
    single: jest.Mock;
    upsert: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  const createBuilder = (result: QueryResult): QueryBuilder => {
    const builder: QueryBuilder = {
      data: result.data,
      error: result.error,
      select: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      neq: jest.fn(() => builder),
      in: jest.fn(() => builder),
      is: jest.fn(() => builder),
      or: jest.fn(() => builder),
      lte: jest.fn(() => builder),
      order: jest.fn(() => builder),
      maybeSingle: jest.fn(() => Promise.resolve(result)),
      single: jest.fn(() => Promise.resolve(result)),
      upsert: jest.fn(() => builder),
      insert: jest.fn(() => builder),
      update: jest.fn(() => builder),
      delete: jest.fn(() => builder),
    };
    return builder;
  };

  const createClient = (queues: Record<string, QueryBuilder[]>) => ({
    from: jest.fn((table: string): QueryBuilder => {
      const tableQueue = queues[table];
      if (!tableQueue || tableQueue.length === 0) {
        throw new Error(`No mock builder available for table: ${table}`);
      }
      return tableQueue.shift() as QueryBuilder;
    }),
  });

  type StripeServiceMock = {
    resolvePriceIds: jest.Mock;
    isWebhookConfigured: boolean;
    listSubscriptions: jest.Mock;
    createCustomer: jest.Mock;
    createCheckout: jest.Mock;
    updateSeats: jest.Mock;
    cancelSubscription: jest.Mock;
    createPortalSession: jest.Mock;
    retrieveSubscription: jest.Mock;
    retrieveCustomerUserId: jest.Mock;
    constructWebhookEvent: jest.Mock;
    toSubscriptionInfo: jest.Mock;
  };

  const createStripeMock = (
    overrides: Partial<StripeServiceMock> = {},
  ): StripeServiceMock => ({
    resolvePriceIds: jest.fn(() =>
      Promise.resolve({ basePriceId: BASE_PRICE, devicePriceId: DEVICE_PRICE }),
    ),
    isWebhookConfigured: true,
    listSubscriptions: jest.fn(() => Promise.resolve([])),
    createCustomer: jest.fn(() => Promise.resolve('cus_new')),
    createCheckout: jest.fn(() =>
      Promise.resolve('https://checkout.stripe.com/session'),
    ),
    updateSeats: jest.fn(),
    cancelSubscription: jest.fn(),
    createPortalSession: jest.fn(),
    retrieveSubscription: jest.fn(),
    retrieveCustomerUserId: jest.fn(() => Promise.resolve(null)),
    constructWebhookEvent: jest.fn(),
    toSubscriptionInfo: jest.fn(),
    ...overrides,
  });

  const createService = (
    client: ReturnType<typeof createClient>,
    stripeService: StripeServiceMock,
  ) =>
    new PaymentsService(
      {
        getClient: jest.fn(() => client),
        getAdminClient: jest.fn(() => client),
      } as unknown as SupabaseService,
      stripeService as unknown as StripeService,
    );

  const user = { sub: 'user-1', email: 'kevin@example.com', isStaff: false };

  const deviceSub = (
    overrides: Partial<BillingSubscriptionInfo> = {},
  ): BillingSubscriptionInfo => ({
    id: 'sub_device',
    priceId: DEVICE_PRICE,
    status: 'active',
    seats: 3,
    discountId: null,
    currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    ...overrides,
  });

  const webhookEvent = (type: string, object: unknown) =>
    ({ type, data: { object } }) as Stripe.Event;

  describe('handleWebhook auth', () => {
    it('rejects with 401 when the webhook secret is not configured', async () => {
      const stripeService = createStripeMock({ isWebhookConfigured: false });
      const service = createService(createClient({}), stripeService);

      await expect(
        service.handleWebhook(Buffer.from('{}'), {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects with 403 when the signature is invalid', async () => {
      const stripeService = createStripeMock({
        constructWebhookEvent: jest.fn(() => {
          throw new Stripe.errors.StripeSignatureVerificationError(
            'stripe-signature',
            '{}',
            { message: 'signature mismatch' },
          );
        }),
      });
      const service = createService(createClient({}), stripeService);

      await expect(
        service.handleWebhook(Buffer.from('{}'), {
          'stripe-signature': 'bad',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('device subscription webhooks', () => {
    const subscriptionPayload = {
      id: 'sub_device',
      customer: 'cus_1',
      metadata: { user_id: 'user-1' },
    };

    it('subscription.updated adds unassigned license rows up to the paid seat count', async () => {
      const linkUpsert = createBuilder({ data: null, error: null });
      const cachePatch = createBuilder({ data: null, error: null });
      const licenseSelect = createBuilder({
        data: [{ id: 11, seat_index: 0, status: 'assigned', dev_eui: 'EUI-1' }],
        error: null,
      });
      const licenseInsert = createBuilder({ data: null, error: null });
      const client = createClient({
        billing_customers: [linkUpsert, cachePatch],
        device_licenses: [licenseSelect, licenseInsert],
      });
      const stripeService = createStripeMock({
        constructWebhookEvent: jest.fn(() =>
          webhookEvent('customer.subscription.updated', subscriptionPayload),
        ),
        retrieveSubscription: jest.fn(() =>
          Promise.resolve(deviceSub({ seats: 3 })),
        ),
      });
      const service = createService(client, stripeService);

      await expect(
        service.handleWebhook(Buffer.from('{}'), { 'stripe-signature': 'ok' }),
      ).resolves.toEqual({ received: true });

      expect(licenseInsert.insert).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: 'user-1',
          stripe_subscription_id: 'sub_device',
          seat_index: 1,
          status: 'unassigned',
        }),
        expect.objectContaining({ seat_index: 2, status: 'unassigned' }),
      ]);
      expect(cachePatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          device_subscription_id: 'sub_device',
          device_seats: 3,
        }),
      );
    });

    it('subscription.updated removes only unassigned rows on seat decrease', async () => {
      const linkUpsert = createBuilder({ data: null, error: null });
      const cachePatch = createBuilder({ data: null, error: null });
      const licenseSelect = createBuilder({
        data: [
          { id: 11, seat_index: 0, status: 'assigned', dev_eui: 'EUI-1' },
          { id: 12, seat_index: 1, status: 'unassigned', dev_eui: null },
          { id: 13, seat_index: 2, status: 'unassigned', dev_eui: null },
        ],
        error: null,
      });
      const licenseDelete = createBuilder({ data: null, error: null });
      const client = createClient({
        billing_customers: [linkUpsert, cachePatch],
        device_licenses: [licenseSelect, licenseDelete],
      });
      const stripeService = createStripeMock({
        constructWebhookEvent: jest.fn(() =>
          webhookEvent('customer.subscription.updated', subscriptionPayload),
        ),
        retrieveSubscription: jest.fn(() =>
          Promise.resolve(deviceSub({ seats: 1 })),
        ),
      });
      const service = createService(client, stripeService);

      await service.handleWebhook(Buffer.from('{}'), {
        'stripe-signature': 'ok',
      });

      // Highest-seat-index unassigned rows go first; the assigned row survives.
      expect(licenseDelete.delete).toHaveBeenCalled();
      expect(licenseDelete.in).toHaveBeenCalledWith('id', [13, 12]);
    });

    it('subscription.deleted wipes all licenses and zeroes the seat cache', async () => {
      const linkUpsert = createBuilder({ data: null, error: null });
      const cachePatch = createBuilder({ data: null, error: null });
      const licenseDelete = createBuilder({ data: null, error: null });
      const client = createClient({
        billing_customers: [linkUpsert, cachePatch],
        device_licenses: [licenseDelete],
      });
      const payloadInfo = deviceSub({ status: 'canceled', seats: 3 });
      const stripeService = createStripeMock({
        constructWebhookEvent: jest.fn(() =>
          webhookEvent('customer.subscription.deleted', subscriptionPayload),
        ),
        toSubscriptionInfo: jest.fn(() => payloadInfo),
      });
      const service = createService(client, stripeService);

      await service.handleWebhook(Buffer.from('{}'), {
        'stripe-signature': 'ok',
      });

      expect(licenseDelete.delete).toHaveBeenCalled();
      expect(licenseDelete.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(cachePatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          device_subscription_id: null,
          device_seats: 0,
        }),
      );
    });

    it('resolves the user via the Stripe customer when metadata and mapping are missing', async () => {
      const mappingLookup = createBuilder({ data: null, error: null });
      const linkUpsert = createBuilder({ data: null, error: null });
      const cachePatch = createBuilder({ data: null, error: null });
      const client = createClient({
        billing_customers: [mappingLookup, linkUpsert, cachePatch],
      });
      const stripeService = createStripeMock({
        constructWebhookEvent: jest.fn(() =>
          webhookEvent('customer.subscription.updated', {
            id: 'sub_base',
            customer: 'cus_9',
            metadata: {},
          }),
        ),
        retrieveSubscription: jest.fn(() =>
          Promise.resolve(
            deviceSub({ id: 'sub_base', priceId: BASE_PRICE, seats: null }),
          ),
        ),
        retrieveCustomerUserId: jest.fn(() => Promise.resolve('user-9')),
      });
      const service = createService(client, stripeService);

      await service.handleWebhook(Buffer.from('{}'), {
        'stripe-signature': 'ok',
      });

      expect(stripeService.retrieveCustomerUserId).toHaveBeenCalledWith(
        'cus_9',
      );
      expect(cachePatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          base_subscription_id: 'sub_base',
          base_status: 'active',
        }),
      );
      expect(cachePatch.eq).toHaveBeenCalledWith('user_id', 'user-9');
    });
  });

  describe('seat and checkout guards', () => {
    it('changeDeviceSeats rejects reducing below the assigned license count', async () => {
      const customerSelect = createBuilder({
        data: { user_id: 'user-1', stripe_customer_id: 'cus_1' },
        error: null,
      });
      const licenseSelect = createBuilder({
        data: [
          {
            id: 11,
            seat_index: 0,
            status: 'assigned',
            dev_eui: 'EUI-1',
            cw_devices: { name: 'Sensor A' },
          },
          {
            id: 12,
            seat_index: 1,
            status: 'assigned',
            dev_eui: 'EUI-2',
            cw_devices: { name: 'Sensor B' },
          },
        ],
        error: null,
      });
      const client = createClient({
        billing_customers: [customerSelect],
        device_licenses: [licenseSelect],
      });
      const stripeService = createStripeMock({
        listSubscriptions: jest.fn(() => Promise.resolve([deviceSub()])),
      });
      const service = createService(client, stripeService);

      await expect(service.changeDeviceSeats(user, 1)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(stripeService.updateSeats).not.toHaveBeenCalled();
    });

    it('createBaseCheckout rejects when a base subscription is already active', async () => {
      const customerSelect = createBuilder({
        data: { user_id: 'user-1', stripe_customer_id: 'cus_1' },
        error: null,
      });
      const client = createClient({ billing_customers: [customerSelect] });
      const stripeService = createStripeMock({
        listSubscriptions: jest.fn(() =>
          Promise.resolve([
            deviceSub({ id: 'sub_base', priceId: BASE_PRICE, seats: null }),
          ]),
        ),
      });
      const service = createService(client, stripeService);

      await expect(service.createBaseCheckout(user)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(stripeService.createCheckout).not.toHaveBeenCalled();
    });

    it('createBaseCheckout lazily creates the Stripe customer on first use', async () => {
      const customerSelect = createBuilder({
        data: { user_id: 'user-1', stripe_customer_id: null },
        error: null,
      });
      const customerPatch = createBuilder({ data: null, error: null });
      const client = createClient({
        billing_customers: [customerSelect, customerPatch],
      });
      const stripeService = createStripeMock();
      const service = createService(client, stripeService);

      await expect(service.createBaseCheckout(user)).resolves.toEqual({
        checkoutUrl: 'https://checkout.stripe.com/session',
      });

      expect(stripeService.createCustomer).toHaveBeenCalledWith(
        'user-1',
        'kevin@example.com',
      );
      expect(customerPatch.update).toHaveBeenCalledWith(
        expect.objectContaining({ stripe_customer_id: 'cus_new' }),
      );
      expect(stripeService.createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          priceId: BASE_PRICE,
          customerId: 'cus_new',
          userId: 'user-1',
        }),
      );
    });
  });
});

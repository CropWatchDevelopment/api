import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentsService } from './payments.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { AccessService } from '../common/authz';
import { StripeService, BillingSubscriptionInfo } from './stripe.service';

const DEVICE_PRICE = 'price_device';
const REPORTING_PRICE = 'price_reporting';

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
    not: jest.Mock;
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
      not: jest.fn(() => builder),
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
      Promise.resolve({
        devicePriceId: DEVICE_PRICE,
        reportingPriceId: REPORTING_PRICE,
      }),
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
      {
        getDeviceAccess: jest.fn().mockResolvedValue({
          exists: true,
          isStaff: false,
          isOwner: true,
          level: 1,
          orgRole: null,
          parentRead: false,
        }),
      } as unknown as AccessService,
    );

  const user = { sub: 'user-1', email: 'kevin@example.com', isStaff: false };
  const staff = { sub: 'staff-1', email: 'ops@cropwatch.io', isStaff: true };

  const stripeCustomer = (overrides: Record<string, unknown> = {}) => ({
    user_id: 'user-1',
    stripe_customer_id: 'cus_1',
    billing_mode: 'stripe',
    device_subscription_id: null,
    device_seats: 0,
    reporting_subscription_id: null,
    reporting_status: null,
    reporting_manual: false,
    ...overrides,
  });

  const manualCustomer = (overrides: Record<string, unknown> = {}) =>
    stripeCustomer({
      stripe_customer_id: null,
      billing_mode: 'manual',
      ...overrides,
    });

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

  const reportingSub = (
    overrides: Partial<BillingSubscriptionInfo> = {},
  ): BillingSubscriptionInfo =>
    deviceSub({
      id: 'sub_reporting',
      priceId: REPORTING_PRICE,
      seats: 1,
      ...overrides,
    });

  const seatRow = (
    id: number,
    seatIndex: number,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    seat_index: seatIndex,
    status: 'unassigned',
    dev_eui: null,
    stripe_subscription_id: 'sub_device',
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

    const updatedEvent = (seats: number) =>
      createStripeMock({
        constructWebhookEvent: jest.fn(() =>
          webhookEvent('customer.subscription.updated', subscriptionPayload),
        ),
        retrieveSubscription: jest.fn(() =>
          Promise.resolve(deviceSub({ seats })),
        ),
      });

    it('subscription.updated adds unassigned license rows up to the paid seat count', async () => {
      const linkUpsert = createBuilder({ data: null, error: null });
      const cachePatch = createBuilder({ data: null, error: null });
      const licenseSelect = createBuilder({
        data: [seatRow(11, 0, { status: 'assigned', dev_eui: 'EUI-1' })],
        error: null,
      });
      const licenseInsert = createBuilder({ data: null, error: null });
      const client = createClient({
        billing_customers: [linkUpsert, cachePatch],
        device_licenses: [licenseSelect, licenseInsert],
      });
      const service = createService(client, updatedEvent(3));

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
          seatRow(11, 0, { status: 'assigned', dev_eui: 'EUI-1' }),
          seatRow(12, 1),
          seatRow(13, 2),
          seatRow(14, 3),
        ],
        error: null,
      });
      const licenseDelete = createBuilder({ data: null, error: null });
      const client = createClient({
        billing_customers: [linkUpsert, cachePatch],
        device_licenses: [licenseSelect, licenseDelete],
      });
      const service = createService(client, updatedEvent(3));

      await service.handleWebhook(Buffer.from('{}'), {
        'stripe-signature': 'ok',
      });

      // Highest-seat-index unassigned row goes first; the assigned row survives.
      expect(licenseDelete.delete).toHaveBeenCalled();
      expect(licenseDelete.in).toHaveBeenCalledWith('id', [14]);
    });

    it('reconcile ignores staff-granted rows but reserves their seat_index', async () => {
      const linkUpsert = createBuilder({ data: null, error: null });
      const cachePatch = createBuilder({ data: null, error: null });
      const licenseSelect = createBuilder({
        data: [
          seatRow(1, 0, { stripe_subscription_id: null }),
          seatRow(2, 1, { stripe_subscription_id: null }),
          seatRow(3, 2),
        ],
        error: null,
      });
      const licenseInsert = createBuilder({ data: null, error: null });
      const client = createClient({
        billing_customers: [linkUpsert, cachePatch],
        device_licenses: [licenseSelect, licenseInsert],
      });
      const service = createService(client, updatedEvent(3));

      await service.handleWebhook(Buffer.from('{}'), {
        'stripe-signature': 'ok',
      });

      // 1 Stripe row exists, target 3 → add 2, starting after the highest index.
      expect(licenseInsert.insert).toHaveBeenCalledWith([
        expect.objectContaining({
          seat_index: 3,
          stripe_subscription_id: 'sub_device',
        }),
        expect.objectContaining({
          seat_index: 4,
          stripe_subscription_id: 'sub_device',
        }),
      ]);
    });

    it('reconcile re-reads once when a concurrent webhook already inserted the seats', async () => {
      const linkUpsert = createBuilder({ data: null, error: null });
      const cachePatch = createBuilder({ data: null, error: null });
      const firstSelect = createBuilder({ data: [], error: null });
      const racedInsert = createBuilder({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      });
      const secondSelect = createBuilder({
        data: [seatRow(1, 0), seatRow(2, 1), seatRow(3, 2)],
        error: null,
      });
      const client = createClient({
        billing_customers: [linkUpsert, cachePatch],
        device_licenses: [firstSelect, racedInsert, secondSelect],
      });
      const service = createService(client, updatedEvent(3));

      await expect(
        service.handleWebhook(Buffer.from('{}'), { 'stripe-signature': 'ok' }),
      ).resolves.toEqual({ received: true });
      expect(racedInsert.insert).toHaveBeenCalledTimes(1);
      expect(secondSelect.select).toHaveBeenCalled();
    });

    it('subscription.deleted wipes Stripe-backed licenses and zeroes the seat cache', async () => {
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
      // Staff-granted rows (NULL subscription id) are left alone.
      expect(licenseDelete.not).toHaveBeenCalledWith(
        'stripe_subscription_id',
        'is',
        null,
      );
      expect(cachePatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          device_subscription_id: null,
          device_seats: 0,
        }),
      );
    });
  });

  describe('reporting subscription webhooks', () => {
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
            id: 'sub_reporting',
            customer: 'cus_9',
            metadata: {},
          }),
        ),
        retrieveSubscription: jest.fn(() => Promise.resolve(reportingSub())),
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
          reporting_subscription_id: 'sub_reporting',
          reporting_status: 'active',
        }),
      );
      expect(cachePatch.eq).toHaveBeenCalledWith('user_id', 'user-9');
    });

    it('subscription.deleted marks reporting canceled and deactivates the report templates', async () => {
      const linkUpsert = createBuilder({ data: null, error: null });
      const cachePatch = createBuilder({ data: null, error: null });
      const templatePatch = createBuilder({ data: null, error: null });
      const client = createClient({
        billing_customers: [linkUpsert, cachePatch],
        cw_report_templates: [templatePatch],
      });
      const stripeService = createStripeMock({
        constructWebhookEvent: jest.fn(() =>
          webhookEvent('customer.subscription.deleted', {
            id: 'sub_reporting',
            customer: 'cus_1',
            metadata: { user_id: 'user-1' },
          }),
        ),
        toSubscriptionInfo: jest.fn(() => reportingSub({ status: 'canceled' })),
      });
      const service = createService(client, stripeService);

      await service.handleWebhook(Buffer.from('{}'), {
        'stripe-signature': 'ok',
      });

      expect(cachePatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          reporting_subscription_id: null,
          reporting_status: 'canceled',
        }),
      );
      expect(templatePatch.update).toHaveBeenCalledWith({ is_active: false });
      expect(templatePatch.eq).toHaveBeenCalledWith('created_by', 'user-1');
    });
  });

  describe('seat and checkout guards', () => {
    it('changeDeviceSeats rejects going below the seat minimum before calling Stripe', async () => {
      const customerSelect = createBuilder({
        data: stripeCustomer(),
        error: null,
      });
      const client = createClient({ billing_customers: [customerSelect] });
      const stripeService = createStripeMock();
      const service = createService(client, stripeService);

      await expect(service.changeDeviceSeats(user, 2)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(stripeService.listSubscriptions).not.toHaveBeenCalled();
      expect(stripeService.updateSeats).not.toHaveBeenCalled();
    });

    it('changeDeviceSeats rejects reducing below the assigned license count', async () => {
      const customerSelect = createBuilder({
        data: stripeCustomer(),
        error: null,
      });
      const licenseSelect = createBuilder({
        data: [
          seatRow(11, 0, {
            status: 'assigned',
            dev_eui: 'EUI-1',
            cw_devices: { name: 'Sensor A' },
          }),
          seatRow(12, 1, {
            status: 'assigned',
            dev_eui: 'EUI-2',
            cw_devices: { name: 'Sensor B' },
          }),
          seatRow(13, 2, {
            status: 'assigned',
            dev_eui: 'EUI-3',
            cw_devices: { name: 'Sensor C' },
          }),
          seatRow(14, 3, {
            status: 'assigned',
            dev_eui: 'EUI-4',
            cw_devices: { name: 'Sensor D' },
          }),
        ],
        error: null,
      });
      const client = createClient({
        billing_customers: [customerSelect],
        device_licenses: [licenseSelect],
      });
      const stripeService = createStripeMock({
        listSubscriptions: jest.fn(() =>
          Promise.resolve([deviceSub({ seats: 4 })]),
        ),
      });
      const service = createService(client, stripeService);

      await expect(service.changeDeviceSeats(user, 3)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(stripeService.updateSeats).not.toHaveBeenCalled();
    });

    it('createDeviceCheckout rejects manual-invoice customers', async () => {
      const customerSelect = createBuilder({
        data: manualCustomer(),
        error: null,
      });
      const client = createClient({ billing_customers: [customerSelect] });
      const stripeService = createStripeMock();
      const service = createService(client, stripeService);

      await expect(
        service.createDeviceCheckout(user, 3),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(stripeService.createCheckout).not.toHaveBeenCalled();
    });

    it('createDeviceCheckout lazily creates the Stripe customer and enforces the seat minimum on the hosted page', async () => {
      const customerSelect = createBuilder({
        data: stripeCustomer({ stripe_customer_id: null }),
        error: null,
      });
      const customerSelectAgain = createBuilder({
        data: stripeCustomer({ stripe_customer_id: null }),
        error: null,
      });
      const customerPatch = createBuilder({ data: null, error: null });
      const client = createClient({
        billing_customers: [customerSelect, customerSelectAgain, customerPatch],
      });
      const stripeService = createStripeMock();
      const service = createService(client, stripeService);

      await expect(service.createDeviceCheckout(user, 3)).resolves.toEqual({
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
          priceId: DEVICE_PRICE,
          customerId: 'cus_new',
          userId: 'user-1',
          quantity: 3,
          adjustableQuantity: { minimum: 3 },
        }),
      );
    });

    it('createReportingCheckout rejects when the add-on is already active', async () => {
      const customerSelect = createBuilder({
        data: stripeCustomer(),
        error: null,
      });
      const customerSelectAgain = createBuilder({
        data: stripeCustomer(),
        error: null,
      });
      const client = createClient({
        billing_customers: [customerSelect, customerSelectAgain],
      });
      const stripeService = createStripeMock({
        listSubscriptions: jest.fn(() => Promise.resolve([reportingSub()])),
      });
      const service = createService(client, stripeService);

      await expect(
        service.createReportingCheckout(user),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(stripeService.createCheckout).not.toHaveBeenCalled();
    });

    it('cancelLicense refuses to drop below the seat minimum', async () => {
      const licenseLoad = createBuilder({
        data: seatRow(13, 2),
        error: null,
      });
      const customerSelect = createBuilder({
        data: stripeCustomer(),
        error: null,
      });
      const licenseList = createBuilder({
        data: [seatRow(11, 0), seatRow(12, 1), seatRow(13, 2)],
        error: null,
      });
      const client = createClient({
        billing_customers: [customerSelect],
        device_licenses: [licenseLoad, licenseList],
      });
      const stripeService = createStripeMock({
        listSubscriptions: jest.fn(() => Promise.resolve([deviceSub()])),
      });
      const service = createService(client, stripeService);

      await expect(service.cancelLicense(user, 13)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(stripeService.updateSeats).not.toHaveBeenCalled();
    });
  });

  describe('manual-invoice mode', () => {
    it('getState never calls Stripe and reports staff-granted seats + reporting', async () => {
      const customerSelect = createBuilder({
        data: manualCustomer({ reporting_manual: true }),
        error: null,
      });
      const licenseList = createBuilder({
        data: [
          seatRow(1, 0, {
            stripe_subscription_id: null,
            status: 'assigned',
            dev_eui: 'EUI-1',
          }),
          seatRow(2, 1, { stripe_subscription_id: null }),
        ],
        error: null,
      });
      const client = createClient({
        billing_customers: [customerSelect],
        device_licenses: [licenseList],
      });
      const stripeService = createStripeMock();
      const service = createService(client, stripeService);

      const state = await service.getState(user);

      expect(stripeService.listSubscriptions).not.toHaveBeenCalled();
      expect(stripeService.resolvePriceIds).not.toHaveBeenCalled();
      expect(state.billingMode).toBe('manual');
      expect(state.device).toEqual(
        expect.objectContaining({
          seats: 2,
          assignedCount: 1,
          availableCount: 1,
        }),
      );
      expect(state.reporting).toEqual(
        expect.objectContaining({ entitled: true, manual: true }),
      );
      expect(state.licenses.map((l) => l.manual)).toEqual([true, true]);
    });

    it('adminSetManualSeats grants unassigned rows with no subscription id', async () => {
      const customerSelect = createBuilder({
        data: manualCustomer(),
        error: null,
      });
      const licenseList = createBuilder({ data: [], error: null });
      const licenseInsert = createBuilder({ data: null, error: null });
      const client = createClient({
        billing_customers: [customerSelect],
        device_licenses: [licenseList, licenseInsert],
      });
      const service = createService(client, createStripeMock());

      await expect(service.adminSetManualSeats('user-1', 3)).resolves.toEqual({
        userId: 'user-1',
        seats: 3,
      });
      expect(licenseInsert.insert).toHaveBeenCalledWith([
        expect.objectContaining({
          seat_index: 0,
          stripe_subscription_id: null,
        }),
        expect.objectContaining({
          seat_index: 1,
          stripe_subscription_id: null,
        }),
        expect.objectContaining({
          seat_index: 2,
          stripe_subscription_id: null,
        }),
      ]);
    });

    it('adminSetManualSeats removes unassigned rows highest seat first and refuses to drop assigned ones', async () => {
      const rows = [
        seatRow(1, 0, {
          stripe_subscription_id: null,
          status: 'assigned',
          dev_eui: 'EUI-1',
        }),
        seatRow(2, 1, { stripe_subscription_id: null }),
        seatRow(3, 2, { stripe_subscription_id: null }),
      ];
      const shrinkClient = createClient({
        billing_customers: [
          createBuilder({ data: manualCustomer(), error: null }),
        ],
        device_licenses: [
          createBuilder({ data: rows, error: null }),
          createBuilder({ data: null, error: null }),
        ],
      });
      const shrink = createService(shrinkClient, createStripeMock());
      await shrink.adminSetManualSeats('user-1', 1);
      const deleteBuilder = shrinkClient.from.mock.results[2]
        .value as QueryBuilder;
      expect(deleteBuilder.delete).toHaveBeenCalled();
      expect(deleteBuilder.in).toHaveBeenCalledWith('id', [3, 2]);

      const refuseClient = createClient({
        billing_customers: [
          createBuilder({ data: manualCustomer(), error: null }),
        ],
        device_licenses: [createBuilder({ data: rows, error: null })],
      });
      const refuse = createService(refuseClient, createStripeMock());
      await expect(
        refuse.adminSetManualSeats('user-1', 0),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('adminSetManualSeats rejects customers on Stripe billing', async () => {
      const client = createClient({
        billing_customers: [
          createBuilder({ data: stripeCustomer(), error: null }),
        ],
      });
      const service = createService(client, createStripeMock());
      await expect(
        service.adminSetManualSeats('user-1', 3),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('hasReportingEntitlement', () => {
    const entitlementRow = (overrides: Record<string, unknown> = {}) => ({
      stripe_customer_id: 'cus_1',
      billing_mode: 'stripe',
      reporting_status: null,
      reporting_manual: false,
      ...overrides,
    });

    it('is always true for staff without touching the database', async () => {
      const client = createClient({});
      const service = createService(client, createStripeMock());
      await expect(service.hasReportingEntitlement(staff)).resolves.toBe(true);
      expect(client.from).not.toHaveBeenCalled();
    });

    it('trusts the staff-granted flag and an active cached status without calling Stripe', async () => {
      const stripeService = createStripeMock();
      const grantedClient = createClient({
        billing_customers: [
          createBuilder({
            data: entitlementRow({
              billing_mode: 'manual',
              reporting_manual: true,
            }),
            error: null,
          }),
        ],
      });
      await expect(
        createService(grantedClient, stripeService).hasReportingEntitlement(
          user,
        ),
      ).resolves.toBe(true);

      const cachedClient = createClient({
        billing_customers: [
          createBuilder({
            data: entitlementRow({ reporting_status: 'active' }),
            error: null,
          }),
        ],
      });
      await expect(
        createService(cachedClient, stripeService).hasReportingEntitlement(
          user,
        ),
      ).resolves.toBe(true);
      expect(stripeService.listSubscriptions).not.toHaveBeenCalled();
    });

    it('denies manual-invoice customers without the staff-granted flag', async () => {
      const client = createClient({
        billing_customers: [
          createBuilder({
            data: entitlementRow({ billing_mode: 'manual' }),
            error: null,
          }),
        ],
      });
      await expect(
        createService(client, createStripeMock()).hasReportingEntitlement(user),
      ).resolves.toBe(false);
    });

    it('consults Stripe when the cache is not active and refreshes the cache', async () => {
      const cachePatch = createBuilder({ data: null, error: null });
      const client = createClient({
        billing_customers: [
          createBuilder({ data: entitlementRow(), error: null }),
          cachePatch,
        ],
      });
      const stripeService = createStripeMock({
        listSubscriptions: jest.fn(() => Promise.resolve([reportingSub()])),
      });
      await expect(
        createService(client, stripeService).hasReportingEntitlement(user),
      ).resolves.toBe(true);
      expect(cachePatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          reporting_subscription_id: 'sub_reporting',
          reporting_status: 'active',
        }),
      );
    });
  });
});

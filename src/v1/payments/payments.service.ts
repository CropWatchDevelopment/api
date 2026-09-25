import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseClient, type PostgrestError } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { SupabaseService } from '../../supabase/supabase.service';
import { AccessService, Action, decide } from '../common/authz';
import type { TableInsert, TableRow } from '../types/supabase';
import { StripeService, BillingSubscriptionInfo } from './stripe.service';
import {
  AdminBillingCustomer,
  BillingEntitlementsResponse,
  BillingLicense,
  BillingMode,
  BillingProductsResponse,
  SEAT_MINIMUM,
  SubscriptionStateResponse,
} from './payments.types';
import type { AuthenticatedUser } from '../auth/authenticated-user';

type BillingCustomerRow = TableRow<'billing_customers'>;
type DeviceLicenseRow = TableRow<'device_licenses'>;
type LicenseSeatRow = Pick<
  DeviceLicenseRow,
  'id' | 'seat_index' | 'status' | 'dev_eui' | 'stripe_subscription_id'
>;

/** Shape of a PostgREST response from the untyped Supabase client. */
type QueryResult<T> = { data: T | null; error: PostgrestError | null };

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];

const MANUAL_MODE_MESSAGE =
  'This account is invoiced by CropWatch. Contact support to change your licenses.';

function toBillingMode(value: string | null | undefined): BillingMode {
  return value === 'manual' ? 'manual' : 'stripe';
}

function isActiveStatus(status: string | null | undefined): boolean {
  return !!status && ACTIVE_SUBSCRIPTION_STATUSES.includes(status);
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly stripeService: StripeService,
    private readonly accessService: AccessService,
  ) {}

  // ---------------------------------------------------------------------------
  // Org billing resolution (plan 6.3)
  //
  // Billing rows stay keyed by the ORG OWNER's user id until the
  // constraints migration re-keys the tables: for a personal org that is
  // the caller themself (exact pre-org behavior), and for a company it is
  // the single owner, so the owner's row IS the org's billing.
  // ---------------------------------------------------------------------------

  /** The org owner's user id for `orgId`, or null when the org has none. */
  private async orgOwnerUserId(
    client: SupabaseClient,
    orgId: string,
  ): Promise<string | null> {
    const { data } = (await client
      .from('organization_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('role', 'owner')
      .maybeSingle()) as QueryResult<{ user_id: string }>;
    return data?.user_id ?? null;
  }

  /**
   * Resolve whose billing row the caller reads: their own when they are the
   * org owner (or have no org), otherwise their org owner's.
   */
  private async resolveBillingUserId(user: AuthenticatedUser): Promise<{
    userId: string;
    orgId: string | null;
  }> {
    const ctx = await this.accessService.getOrgContext(user);
    if (!ctx.org) {
      return { userId: user.sub, orgId: null };
    }
    if (ctx.org.role === 'owner') {
      return { userId: user.sub, orgId: ctx.org.id };
    }
    const client = this.supabaseService.getClient();
    const owner = await this.orgOwnerUserId(client, ctx.org.id);
    return { userId: owner ?? user.sub, orgId: ctx.org.id };
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async getProducts(): Promise<BillingProductsResponse> {
    const { devicePriceId, reportingPriceId } =
      await this.stripeService.resolvePriceIds();
    const products = await this.stripeService.listProducts([
      devicePriceId,
      reportingPriceId,
    ]);
    return {
      device: products.find((p) => p.id === devicePriceId) ?? null,
      reporting: products.find((p) => p.id === reportingPriceId) ?? null,
    };
  }

  async getState(user: AuthenticatedUser): Promise<SubscriptionStateResponse> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const customer = await this.ensureBillingCustomer(client, userId);

    // Manual-invoice customers: everything is staff-granted, nothing in Stripe.
    if (toBillingMode(customer.billing_mode) === 'manual') {
      const licenses = await this.fetchLicenses(client, userId);
      const assignedCount = licenses.filter(
        (l) => l.status === 'assigned' && l.devEui,
      ).length;
      return {
        billingMode: 'manual',
        device: {
          subscriptionId: null,
          status: licenses.length > 0 ? 'active' : null,
          seats: licenses.length,
          minimumSeats: SEAT_MINIMUM,
          assignedCount,
          availableCount: Math.max(0, licenses.length - assignedCount),
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        },
        reporting: {
          subscriptionId: null,
          status: customer.reporting_manual ? 'active' : null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          entitled: customer.reporting_manual,
          manual: true,
        },
        licenses,
      };
    }

    const { devicePriceId, reportingPriceId } =
      await this.stripeService.resolvePriceIds();
    const subscriptions = await this.listSubscriptionsSafe(
      customer.stripe_customer_id,
    );
    const deviceSub = this.pickSubscription(subscriptions, devicePriceId);
    const reportingSub = this.pickSubscription(subscriptions, reportingPriceId);

    // Keep the local license rows in sync with the paid seat count. The webhook
    // is the primary driver, but reconciling here makes the page self-healing
    // (e.g. in environments where webhooks aren't wired up yet).
    if (deviceSub) {
      const targetSeats = this.effectiveSeats(deviceSub);
      await this.reconcileSeats(client, userId, deviceSub.id, targetSeats);
    }

    await this.patchBillingCustomerCache(
      client,
      userId,
      deviceSub,
      reportingSub,
    );

    const licenses = await this.fetchLicenses(client, userId);
    const assignedCount = licenses.filter(
      (l) => l.status === 'assigned' && l.devEui,
    ).length;
    const seats = deviceSub ? this.effectiveSeats(deviceSub) : 0;
    const reportingActive =
      !!reportingSub && isActiveStatus(reportingSub.status);

    return {
      billingMode: 'stripe',
      device: {
        subscriptionId: deviceSub?.id ?? null,
        status: deviceSub?.status ?? null,
        seats,
        minimumSeats: SEAT_MINIMUM,
        assignedCount,
        availableCount: Math.max(0, seats - assignedCount),
        currentPeriodEnd: deviceSub?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: deviceSub?.cancelAtPeriodEnd ?? false,
      },
      reporting: {
        subscriptionId: reportingSub?.id ?? null,
        status: reportingSub?.status ?? null,
        currentPeriodEnd: reportingSub?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: reportingSub?.cancelAtPeriodEnd ?? false,
        entitled: reportingActive || customer.reporting_manual,
        manual: !reportingActive && customer.reporting_manual,
      },
      licenses,
    };
  }

  async getLicenses(user: AuthenticatedUser): Promise<BillingLicense[]> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();
    return this.fetchLicenses(client, userId);
  }

  /**
   * DB-only entitlement summary for pages that only need to know what the
   * user may do. Never calls Stripe — the cached reporting status is kept
   * current by the webhook and by getState().
   */
  async getEntitlements(
    user: AuthenticatedUser,
  ): Promise<BillingEntitlementsResponse> {
    // Members and managers read their ORG's entitlement flags (booleans
    // only — never invoices, payment methods, or seat management).
    const { userId } = await this.resolveBillingUserId(user);
    const client = this.supabaseService.getClient();

    const { data: row } = (await client
      .from('billing_customers')
      .select('billing_mode, reporting_status, reporting_manual')
      .eq('user_id', userId)
      .maybeSingle()) as QueryResult<
      Pick<
        BillingCustomerRow,
        'billing_mode' | 'reporting_status' | 'reporting_manual'
      >
    >;

    const { count } = await client
      .from('device_licenses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    const billingMode = toBillingMode(row?.billing_mode);
    const reporting =
      user.isStaff ||
      !!row?.reporting_manual ||
      (billingMode === 'stripe' && isActiveStatus(row?.reporting_status));

    return {
      billingMode,
      isStaff: user.isStaff,
      seats: count ?? 0,
      reporting,
    };
  }

  /**
   * Whether the user may create / edit / regenerate reports. Staff always
   * may; a staff-granted flag always grants; otherwise the Stripe reporting
   * add-on must be active. The cached status is trusted when active (the
   * webhook clears it when the add-on lapses); when it is not, Stripe is
   * consulted once and the cache refreshed. Stripe outages fall back to the
   * cache so a transient error never blocks a legitimately-subscribed user.
   */
  async hasReportingEntitlement(
    user: AuthenticatedUser,
    deviceOrgId?: string | null,
  ): Promise<boolean> {
    if (user.isStaff) {
      return true;
    }
    const client = this.supabaseService.getClient();
    // The entitlement belongs to the org that owns the report's devices
    // (plan 6.3); without one, the caller's own org billing applies.
    const userId = deviceOrgId
      ? ((await this.orgOwnerUserId(client, deviceOrgId)) ?? user.sub)
      : (await this.resolveBillingUserId(user)).userId;

    const { data: row } = (await client
      .from('billing_customers')
      .select(
        'stripe_customer_id, billing_mode, reporting_status, reporting_manual',
      )
      .eq('user_id', userId)
      .maybeSingle()) as QueryResult<
      Pick<
        BillingCustomerRow,
        | 'stripe_customer_id'
        | 'billing_mode'
        | 'reporting_status'
        | 'reporting_manual'
      >
    >;
    if (!row) {
      return false;
    }
    if (row.reporting_manual) {
      return true;
    }
    if (toBillingMode(row.billing_mode) === 'manual') {
      return false;
    }
    if (isActiveStatus(row.reporting_status)) {
      return true;
    }
    if (!row.stripe_customer_id) {
      return false;
    }

    try {
      const { reportingPriceId } = await this.stripeService.resolvePriceIds();
      if (!reportingPriceId) {
        throw new Error('Stripe reporting price id could not be resolved');
      }
      const subscriptions = await this.stripeService.listSubscriptions(
        row.stripe_customer_id,
      );
      const reportingSub = this.pickSubscription(
        subscriptions,
        reportingPriceId,
      );
      await this.patchBillingCustomer(client, userId, {
        reporting_subscription_id: reportingSub?.id ?? null,
        reporting_status: reportingSub?.status ?? null,
      });
      return !!reportingSub && isActiveStatus(reportingSub.status);
    } catch (error) {
      this.logger.warn(
        `Reporting entitlement check fell back to cache for ${userId}: ${String(error)}`,
      );
      return isActiveStatus(row.reporting_status);
    }
  }

  // ---------------------------------------------------------------------------
  // Checkout / seats / portal / cancel
  // ---------------------------------------------------------------------------

  async createDeviceCheckout(
    user: AuthenticatedUser,
    quantity: number,
  ): Promise<{ checkoutUrl: string }> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const customer = await this.ensureBillingCustomer(client, userId);
    this.assertStripeMode(customer);
    if (quantity < SEAT_MINIMUM) {
      throw new BadRequestException(
        `Device subscriptions have a minimum of ${SEAT_MINIMUM} licenses.`,
      );
    }
    const customerId = await this.ensureStripeCustomer(client, user);

    const { devicePriceId } = await this.stripeService.resolvePriceIds();
    const subscriptions = await this.listSubscriptionsSafe(customerId);
    const existing = this.pickSubscription(subscriptions, devicePriceId);
    if (existing && isActiveStatus(existing.status)) {
      throw new ConflictException(
        'A device subscription already exists. Change the seat count instead.',
      );
    }

    const { orgId } = await this.resolveBillingUserId(user);
    const checkoutUrl = await this.stripeService.createCheckout({
      priceId: this.requirePriceId(devicePriceId, 'device'),
      customerId,
      userId,
      orgId,
      quantity,
      // Let the customer adjust the seat count on the hosted checkout page
      // (never below the minimum); the final quantity is confirmed by the
      // webhook / getState reconcile.
      adjustableQuantity: { minimum: SEAT_MINIMUM },
    });
    return { checkoutUrl };
  }

  async createReportingCheckout(
    user: AuthenticatedUser,
  ): Promise<{ checkoutUrl: string }> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const customer = await this.ensureBillingCustomer(client, userId);
    this.assertStripeMode(customer);
    const customerId = await this.ensureStripeCustomer(client, user);

    const { reportingPriceId } = await this.stripeService.resolvePriceIds();
    const subscriptions = await this.listSubscriptionsSafe(customerId);
    const existing = this.pickSubscription(subscriptions, reportingPriceId);
    if (existing && isActiveStatus(existing.status)) {
      throw new ConflictException('The reporting package is already active.');
    }

    const { orgId } = await this.resolveBillingUserId(user);
    const checkoutUrl = await this.stripeService.createCheckout({
      priceId: this.requirePriceId(reportingPriceId, 'reporting'),
      customerId,
      userId,
      orgId,
      quantity: 1,
    });
    return { checkoutUrl };
  }

  async changeDeviceSeats(
    user: AuthenticatedUser,
    seats: number,
  ): Promise<{ seats: number }> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const customer = await this.ensureBillingCustomer(client, userId);
    this.assertStripeMode(customer);
    if (seats < SEAT_MINIMUM) {
      throw new BadRequestException(
        `Device subscriptions have a minimum of ${SEAT_MINIMUM} licenses. Cancel the device subscription to go lower.`,
      );
    }

    const { devicePriceId } = await this.stripeService.resolvePriceIds();
    const subscriptions = await this.listSubscriptionsSafe(
      customer.stripe_customer_id,
    );
    const deviceSub = this.pickSubscription(subscriptions, devicePriceId);
    if (!deviceSub) {
      throw new BadRequestException(
        'No device subscription yet. Purchase device licenses first.',
      );
    }

    const licenses = await this.fetchLicenses(client, userId);
    const assigned = licenses.filter(
      (l) => l.status === 'assigned' && l.devEui,
    );
    if (seats < assigned.length) {
      const names = assigned
        .map((l) => l.deviceName ?? l.devEui)
        .filter(Boolean)
        .join(', ');
      throw new ConflictException(
        `Cannot reduce to ${seats} licenses: ${assigned.length} are assigned. Unassign first (${names}).`,
      );
    }

    await this.stripeService.updateSeats(deviceSub.id, seats);
    // Optimistic local sync; the subscription.updated webhook will confirm.
    await this.reconcileSeats(client, userId, deviceSub.id, seats);
    return { seats };
  }

  async openPortal(user: AuthenticatedUser): Promise<{ portalUrl: string }> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const customer = await this.ensureBillingCustomer(client, userId);
    if (!customer.stripe_customer_id) {
      throw new BadRequestException(
        'No billing account yet. Subscribe before opening the billing portal.',
      );
    }

    try {
      const portalUrl = await this.stripeService.createPortalSession(
        customer.stripe_customer_id,
      );
      return { portalUrl };
    } catch (error) {
      this.logger.warn(
        `Failed to open Stripe portal for ${userId}: ${String(error)}`,
      );
      throw new BadRequestException(
        'No billing account yet. Subscribe before opening the billing portal.',
      );
    }
  }

  /**
   * Cancel the whole device subscription. Immediate cancellation tears the
   * license rows down right away; a period-end cancellation leaves them in
   * place until the subscription.deleted webhook arrives.
   */
  async cancelDeviceSubscription(
    user: AuthenticatedUser,
    atPeriodEnd: boolean,
  ): Promise<{ status: string }> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const customer = await this.ensureBillingCustomer(client, userId);
    this.assertStripeMode(customer);
    const { devicePriceId } = await this.stripeService.resolvePriceIds();
    const subscriptions = await this.listSubscriptionsSafe(
      customer.stripe_customer_id,
    );
    const deviceSub = this.pickSubscription(subscriptions, devicePriceId);
    if (!deviceSub) {
      throw new NotFoundException('No device subscription to cancel.');
    }

    await this.stripeService.cancelSubscription(deviceSub.id, atPeriodEnd);

    if (!atPeriodEnd) {
      await this.deleteStripeLicenses(client, userId);
      await this.patchBillingCustomer(client, userId, {
        device_subscription_id: null,
        device_seats: 0,
      });
    }
    return { status: atPeriodEnd ? 'canceling' : 'canceled' };
  }

  async cancelReportingSubscription(
    user: AuthenticatedUser,
    atPeriodEnd: boolean,
  ): Promise<{ status: string }> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const customer = await this.ensureBillingCustomer(client, userId);
    this.assertStripeMode(customer);
    const { reportingPriceId } = await this.stripeService.resolvePriceIds();
    const subscriptions = await this.listSubscriptionsSafe(
      customer.stripe_customer_id,
    );
    const reportingSub = this.pickSubscription(subscriptions, reportingPriceId);
    if (!reportingSub) {
      throw new NotFoundException('No reporting subscription to cancel.');
    }

    const updated = await this.stripeService.cancelSubscription(
      reportingSub.id,
      atPeriodEnd,
    );
    await this.patchBillingCustomer(client, userId, {
      reporting_subscription_id: atPeriodEnd ? reportingSub.id : null,
      reporting_status: updated.status,
    });
    if (!atPeriodEnd) {
      await this.deactivateReportTemplates(client, userId);
    }
    return { status: atPeriodEnd ? 'canceling' : 'canceled' };
  }

  // ---------------------------------------------------------------------------
  // License assignment (CropWatch-owned; no Stripe calls)
  // ---------------------------------------------------------------------------

  /**
   * Pre-flight check for the device-create license gate: the caller must own
   * license `licenseId` and it must not be assigned to a device. Throws the
   * same errors assignLicense would, so validating before a create and
   * assigning after it stay consistent.
   */
  async assertLicenseAvailable(
    user: AuthenticatedUser,
    licenseId: number,
  ): Promise<void> {
    const client = this.supabaseService.getClient();
    const license = await this.loadOwnedLicense(client, user.sub, licenseId);
    if (license.status === 'assigned' && license.dev_eui) {
      throw new ConflictException(
        'License is already assigned. Move it or unassign it first.',
      );
    }
  }

  async assignLicense(
    user: AuthenticatedUser,
    licenseId: number,
    devEui: string,
  ): Promise<BillingLicense> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const license = await this.loadOwnedLicense(client, userId, licenseId);
    if (license.status === 'assigned' && license.dev_eui) {
      throw new ConflictException(
        'License is already assigned. Move it or unassign it first.',
      );
    }

    await this.assertDeviceManageable(user, devEui);
    await this.assertDeviceUnlicensed(client, devEui, licenseId);

    return this.setLicenseDevice(client, userId, licenseId, devEui);
  }

  async moveLicense(
    user: AuthenticatedUser,
    licenseId: number,
    devEui: string,
  ): Promise<BillingLicense> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    await this.loadOwnedLicense(client, userId, licenseId);
    await this.assertDeviceManageable(user, devEui);
    await this.assertDeviceUnlicensed(client, devEui, licenseId);

    return this.setLicenseDevice(client, userId, licenseId, devEui);
  }

  async unassignLicense(
    user: AuthenticatedUser,
    licenseId: number,
  ): Promise<BillingLicense> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    await this.loadOwnedLicense(client, userId, licenseId);

    const { error } = await client
      .from('device_licenses')
      .update({
        dev_eui: null,
        status: 'unassigned',
        updated_at: new Date().toISOString(),
      })
      .eq('id', licenseId)
      .eq('user_id', userId);
    if (error) {
      throw new InternalServerErrorException('Failed to unassign license');
    }

    return this.fetchLicense(client, userId, licenseId);
  }

  /**
   * Cancel a single UNASSIGNED Stripe-backed license: drops the paid seat
   * count by one. Never goes below the seat minimum — cancel the device
   * subscription for that. Assigned licenses must be unassigned first.
   */
  async cancelLicense(
    user: AuthenticatedUser,
    licenseId: number,
  ): Promise<{ canceled: boolean }> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const license = await this.loadOwnedLicense(client, userId, licenseId);
    if (license.stripe_subscription_id === null) {
      throw new BadRequestException(MANUAL_MODE_MESSAGE);
    }
    if (license.dev_eui || license.status === 'assigned') {
      throw new ConflictException(
        'Only unassigned licenses can be canceled. Unassign it from its device first.',
      );
    }

    const customer = await this.ensureBillingCustomer(client, userId);
    const { devicePriceId } = await this.stripeService.resolvePriceIds();
    const subscriptions = await this.listSubscriptionsSafe(
      customer.stripe_customer_id,
    );
    const deviceSub = this.pickSubscription(subscriptions, devicePriceId);
    if (!deviceSub) {
      throw new BadRequestException('No device subscription found.');
    }

    const stripeSeats = (await this.fetchLicenses(client, userId)).filter(
      (l) => !l.manual,
    ).length;
    const target = stripeSeats - 1;
    if (target < SEAT_MINIMUM) {
      throw new ConflictException(
        `Device subscriptions have a minimum of ${SEAT_MINIMUM} licenses. Cancel the device subscription instead.`,
      );
    }

    await this.stripeService.updateSeats(deviceSub.id, target);

    // Remove this specific seat now; the resulting webhook reconciles to match.
    const { error } = await client
      .from('device_licenses')
      .delete()
      .eq('id', licenseId)
      .eq('user_id', userId)
      .is('dev_eui', null);
    if (error) {
      throw new InternalServerErrorException('Failed to cancel license');
    }

    return { canceled: true };
  }

  // ---------------------------------------------------------------------------
  // Staff administration
  // ---------------------------------------------------------------------------

  /**
   * Every device owner and every billing customer, with device / license /
   * subscription counts — the staff overview used to spot legacy unlicensed
   * devices and to manage manual-invoice customers.
   */
  async adminListCustomers(): Promise<AdminBillingCustomer[]> {
    const client = this.supabaseService.getAdminClient();

    const [profiles, devices, ownerRows, licenses, customers] =
      await Promise.all([
        this.readAll<Pick<TableRow<'profiles'>, 'id' | 'email' | 'full_name'>>(
          client,
          'profiles',
          'id, email, full_name',
        ),
        this.readAll<Pick<TableRow<'cw_devices'>, 'dev_eui' | 'user_id'>>(
          client,
          'cw_devices',
          'dev_eui, user_id',
        ),
        this.readAll<
          Pick<
            TableRow<'cw_device_owners'>,
            'dev_eui' | 'user_id' | 'permission_level'
          >
        >(client, 'cw_device_owners', 'dev_eui, user_id, permission_level'),
        this.readAll<
          Pick<
            DeviceLicenseRow,
            'user_id' | 'dev_eui' | 'stripe_subscription_id'
          >
        >(
          client,
          'device_licenses',
          'user_id, dev_eui, stripe_subscription_id',
        ),
        this.readAll<BillingCustomerRow>(client, 'billing_customers', '*'),
      ]);

    // Device owner = cw_devices.user_id, else the first admin-level owner row.
    const adminOwnerByDevice = new Map<string, string>();
    for (const row of ownerRows) {
      if (
        Number(row.permission_level) === 1 &&
        !adminOwnerByDevice.has(row.dev_eui)
      ) {
        adminOwnerByDevice.set(row.dev_eui, row.user_id);
      }
    }
    const devicesByOwner = new Map<string, string[]>();
    for (const device of devices) {
      const owner = device.user_id ?? adminOwnerByDevice.get(device.dev_eui);
      if (!owner) {
        continue;
      }
      const list = devicesByOwner.get(owner) ?? [];
      list.push(device.dev_eui);
      devicesByOwner.set(owner, list);
    }

    const licensedDevices = new Set(
      licenses.map((l) => l.dev_eui).filter((d): d is string => !!d),
    );
    const licensesByUser = new Map<string, typeof licenses>();
    for (const license of licenses) {
      const list = licensesByUser.get(license.user_id) ?? [];
      list.push(license);
      licensesByUser.set(license.user_id, list);
    }
    const customerByUser = new Map(customers.map((c) => [c.user_id, c]));
    const profileByUser = new Map(profiles.map((p) => [p.id, p]));

    const userIds = new Set<string>([
      ...devicesByOwner.keys(),
      ...customerByUser.keys(),
    ]);

    const rows: AdminBillingCustomer[] = [];
    for (const userId of userIds) {
      const profile = profileByUser.get(userId);
      const customer = customerByUser.get(userId);
      const owned = devicesByOwner.get(userId) ?? [];
      const userLicenses = licensesByUser.get(userId) ?? [];
      rows.push({
        userId,
        email: profile?.email ?? null,
        fullName: profile?.full_name ?? null,
        billingMode: toBillingMode(customer?.billing_mode),
        deviceCount: owned.length,
        licensedDeviceCount: owned.filter((d) => licensedDevices.has(d)).length,
        seatCount: userLicenses.length,
        manualSeatCount: userLicenses.filter(
          (l) => l.stripe_subscription_id === null,
        ).length,
        stripeCustomerId: customer?.stripe_customer_id ?? null,
        deviceSubscriptionId: customer?.device_subscription_id ?? null,
        deviceSeats: customer?.device_seats ?? 0,
        reportingStatus: customer?.reporting_status ?? null,
        reportingManual: customer?.reporting_manual ?? false,
      });
    }

    return rows.sort((a, b) =>
      (a.email ?? '').localeCompare(b.email ?? '', undefined, {
        sensitivity: 'base',
      }),
    );
  }

  async adminSetBillingMode(
    userId: string,
    billingMode: BillingMode,
  ): Promise<{ userId: string; billingMode: BillingMode }> {
    const client = this.supabaseService.getAdminClient();
    const customer = await this.ensureBillingCustomer(client, userId);
    if (toBillingMode(customer.billing_mode) === billingMode) {
      return { userId, billingMode };
    }

    if (billingMode === 'stripe') {
      // Staff-granted seats cannot coexist with a Stripe device subscription.
      const { count } = await client
        .from('device_licenses')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('stripe_subscription_id', null);
      if ((count ?? 0) > 0) {
        throw new ConflictException(
          'Revoke the staff-granted licenses before switching this customer to Stripe billing.',
        );
      }
    } else if (
      customer.device_subscription_id ||
      isActiveStatus(customer.reporting_status)
    ) {
      throw new ConflictException(
        'Cancel the Stripe subscriptions before switching this customer to manual invoicing.',
      );
    }

    await this.patchBillingCustomer(client, userId, {
      billing_mode: billingMode,
    });
    return { userId, billingMode };
  }

  /**
   * Set the number of staff-granted seats for a manual-invoice customer
   * (absolute target). Adds unassigned rows or removes unassigned ones —
   * assigned staff-granted seats are never removed here.
   */
  async adminSetManualSeats(
    userId: string,
    seats: number,
  ): Promise<{ userId: string; seats: number }> {
    const client = this.supabaseService.getAdminClient();
    const customer = await this.ensureBillingCustomer(client, userId);
    if (toBillingMode(customer.billing_mode) !== 'manual') {
      throw new BadRequestException(
        'Staff-granted licenses require the customer to be on manual invoicing.',
      );
    }

    const rows = await this.readSeatRows(client, userId);
    const manualRows = rows.filter((r) => r.stripe_subscription_id === null);
    const current = manualRows.length;

    if (seats > current) {
      const startIndex =
        rows.length > 0 ? Math.max(...rows.map((r) => r.seat_index)) + 1 : 0;
      const inserts: TableInsert<'device_licenses'>[] = [];
      for (let i = 0; i < seats - current; i += 1) {
        inserts.push({
          user_id: userId,
          stripe_subscription_id: null,
          seat_index: startIndex + i,
          dev_eui: null,
          status: 'unassigned',
        });
      }
      const { error } = await client.from('device_licenses').insert(inserts);
      if (error) {
        throw new InternalServerErrorException('Failed to grant licenses');
      }
    } else if (seats < current) {
      const removable = manualRows
        .filter((r) => r.status !== 'assigned' && !r.dev_eui)
        .sort((a, b) => b.seat_index - a.seat_index);
      const need = current - seats;
      if (removable.length < need) {
        throw new ConflictException(
          `Cannot reduce to ${seats} licenses: ${current - removable.length} staff-granted licenses are assigned to devices. Unassign them first.`,
        );
      }
      const { error } = await client
        .from('device_licenses')
        .delete()
        .in(
          'id',
          removable.slice(0, need).map((r) => r.id),
        );
      if (error) {
        throw new InternalServerErrorException('Failed to revoke licenses');
      }
    }

    return { userId, seats };
  }

  async adminSetReportingManual(
    userId: string,
    manual: boolean,
  ): Promise<{ userId: string; reportingManual: boolean }> {
    const client = this.supabaseService.getAdminClient();
    await this.ensureBillingCustomer(client, userId);
    await this.patchBillingCustomer(client, userId, {
      reporting_manual: manual,
    });
    return { userId, reportingManual: manual };
  }

  // ---------------------------------------------------------------------------
  // Webhook
  // ---------------------------------------------------------------------------

  async handleWebhook(
    rawBody: Buffer | string,
    headers: Record<string, string>,
  ): Promise<{ received: boolean }> {
    if (!this.stripeService.isWebhookConfigured) {
      this.logger.error(
        'STRIPE_WEBHOOK_SECRET is not configured — rejecting Stripe webhook',
      );
      throw new UnauthorizedException('Stripe webhook is not configured');
    }

    let event: Stripe.Event;
    try {
      event = this.stripeService.constructWebhookEvent(
        rawBody,
        headers['stripe-signature'] ?? '',
      );
    } catch (error) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        throw new ForbiddenException('Invalid Stripe webhook signature');
      }
      throw error;
    }

    const client = this.supabaseService.getAdminClient();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = this.readId(session.customer);
        // The reference is `org:<orgId>` for org-aware checkouts and a bare
        // user id for pre-organization sessions still in flight.
        const referenceUserId = await this.resolveBillingReference(
          client,
          session.client_reference_id ?? null,
        );
        await this.linkCustomer(client, referenceUserId, customerId);
        // Converge subscription state immediately in case the
        // customer.subscription.* events arrived first (or are delayed).
        const subscriptionId = this.readId(session.subscription);
        if (subscriptionId && referenceUserId && customerId) {
          const info = await this.fetchSubscriptionInfo(subscriptionId, null);
          if (info) {
            await this.applySubscriptionState(
              client,
              referenceUserId,
              customerId,
              info,
              false,
            );
          }
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const payload = event.data.object;
        const customerId = this.readId(payload.customer);
        const userId = await this.resolveWebhookUserId(
          client,
          payload,
          customerId,
        );
        if (!userId) {
          this.logger.warn(
            `Stripe ${event.type} for subscription ${payload.id} could not be resolved to a user — skipping`,
          );
          break;
        }
        // Re-fetch the live subscription so out-of-order event delivery still
        // converges on current state (falls back to the event payload).
        const info = await this.fetchSubscriptionInfo(payload.id, payload);
        if (info) {
          await this.applySubscriptionState(
            client,
            userId,
            customerId,
            info,
            false,
          );
        }
        break;
      }
      case 'customer.subscription.deleted': {
        // Terminal event: the payload is authoritative.
        const payload = event.data.object;
        const customerId = this.readId(payload.customer);
        const userId = await this.resolveWebhookUserId(
          client,
          payload,
          customerId,
        );
        if (!userId) {
          this.logger.warn(
            `Stripe ${event.type} for subscription ${payload.id} could not be resolved to a user — skipping`,
          );
          break;
        }
        await this.applySubscriptionState(
          client,
          userId,
          customerId,
          this.stripeService.toSubscriptionInfo(payload),
          true,
        );
        break;
      }
      default:
        // Other events are not relevant to billing state.
        break;
    }

    return { received: true };
  }

  private async applySubscriptionState(
    client: SupabaseClient,
    userId: string,
    customerId: string | null,
    subscription: BillingSubscriptionInfo,
    isDeleted: boolean,
  ): Promise<void> {
    await this.linkCustomer(client, userId, customerId);

    const { devicePriceId, reportingPriceId } =
      await this.stripeService.resolvePriceIds();

    if (reportingPriceId && subscription.priceId === reportingPriceId) {
      if (isDeleted || subscription.status === 'canceled') {
        await this.patchBillingCustomer(client, userId, {
          reporting_subscription_id: null,
          reporting_status: 'canceled',
        });
        await this.deactivateReportTemplates(client, userId);
        return;
      }
      await this.patchBillingCustomer(client, userId, {
        reporting_subscription_id: subscription.id,
        reporting_status: subscription.status,
      });
      return;
    }

    if (devicePriceId && subscription.priceId === devicePriceId) {
      // Deleted (or status 'canceled') = access has actually ended — either an
      // immediate cancel or a scheduled cancel reaching period end. Tear down
      // EVERY Stripe-backed license, assigned or not. A still-scheduled cancel
      // (cancel_at_period_end=true while status stays 'active') keeps the seats
      // live, so we fall through and reconcile to the current paid seat count.
      if (isDeleted || subscription.status === 'canceled') {
        await this.deleteStripeLicenses(client, userId);
        await this.patchBillingCustomer(client, userId, {
          device_subscription_id: null,
          device_seats: 0,
        });
        return;
      }

      const seats = subscription.seats ?? 0;
      await this.patchBillingCustomer(client, userId, {
        device_subscription_id: subscription.id,
        device_seats: seats,
      });
      await this.reconcileSeats(client, userId, subscription.id, seats);
    }
  }

  /**
   * Turn a checkout client reference into the billing user id:
   * `org:<orgId>` resolves to the org owner's row; anything else is a
   * legacy bare user id.
   */
  private async resolveBillingReference(
    client: SupabaseClient,
    reference: string | null,
  ): Promise<string | null> {
    if (!reference) {
      return null;
    }
    if (reference.startsWith('org:')) {
      return this.orgOwnerUserId(client, reference.slice('org:'.length));
    }
    return reference;
  }

  /**
   * Resolve which billing user a webhook subscription belongs to (plan
   * 6.3 order): metadata.org_id -> the org owner's row; legacy
   * metadata.user_id; the local customer mapping; the Stripe customer's
   * metadata.
   */
  private async resolveWebhookUserId(
    client: SupabaseClient,
    subscription: Stripe.Subscription,
    customerId: string | null,
  ): Promise<string | null> {
    const fromOrgMetadata = subscription.metadata?.org_id;
    if (fromOrgMetadata) {
      const owner = await this.orgOwnerUserId(client, fromOrgMetadata);
      if (owner) {
        return owner;
      }
    }
    const fromMetadata = subscription.metadata?.user_id;
    if (fromMetadata) {
      return fromMetadata;
    }

    if (!customerId) {
      return null;
    }

    const { data } = (await client
      .from('billing_customers')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()) as QueryResult<Pick<BillingCustomerRow, 'user_id'>>;
    if (data?.user_id) {
      return data.user_id;
    }

    try {
      return await this.stripeService.retrieveCustomerUserId(customerId);
    } catch (error) {
      this.logger.warn(
        `Failed to resolve user for Stripe customer ${customerId}: ${String(error)}`,
      );
      return null;
    }
  }

  /** Fetch live subscription state, falling back to the webhook payload. */
  private async fetchSubscriptionInfo(
    subscriptionId: string,
    fallback: Stripe.Subscription | null,
  ): Promise<BillingSubscriptionInfo | null> {
    try {
      return await this.stripeService.retrieveSubscription(subscriptionId);
    } catch (error) {
      this.logger.warn(
        `Failed to re-fetch Stripe subscription ${subscriptionId}: ${String(error)}`,
      );
      return fallback ? this.stripeService.toSubscriptionInfo(fallback) : null;
    }
  }

  // ---------------------------------------------------------------------------
  // Seat reconciliation — converge Stripe-backed license rows to the paid
  // seat count. Idempotent: only ever inserts unassigned rows or deletes
  // unassigned rows. Assigned rows are never destroyed here (the API blocks
  // decreases below the assigned count); an unsatisfiable decrease is logged
  // as an overage. Staff-granted rows (NULL subscription id) are ignored
  // entirely, apart from reserving their seat_index values.
  // ---------------------------------------------------------------------------

  private async reconcileSeats(
    client: SupabaseClient,
    userId: string,
    subscriptionId: string,
    targetSeats: number,
    retried = false,
  ): Promise<void> {
    const rows = await this.readSeatRows(client, userId);
    const stripeRows = rows.filter((r) => r.stripe_subscription_id !== null);
    const current = stripeRows.length;

    if (targetSeats > current) {
      const startIndex =
        rows.length > 0 ? Math.max(...rows.map((r) => r.seat_index)) + 1 : 0;
      const inserts: TableInsert<'device_licenses'>[] = [];
      for (let i = 0; i < targetSeats - current; i += 1) {
        inserts.push({
          user_id: userId,
          stripe_subscription_id: subscriptionId,
          seat_index: startIndex + i,
          dev_eui: null,
          status: 'unassigned',
        });
      }
      const { error: insertError } = await client
        .from('device_licenses')
        .insert(inserts);
      if (insertError) {
        // checkout.session.completed and customer.subscription.created arrive
        // near-simultaneously and both try to add the same seats; the loser
        // hits the (user_id, seat_index) unique constraint. Re-read once — the
        // winner's rows now exist, so this converges to a no-op.
        if (insertError.code === '23505' && !retried) {
          return this.reconcileSeats(
            client,
            userId,
            subscriptionId,
            targetSeats,
            true,
          );
        }
        throw new InternalServerErrorException('Failed to add device licenses');
      }
      return;
    }

    if (targetSeats < current) {
      const removable = stripeRows
        .filter((r) => r.status !== 'assigned' && !r.dev_eui)
        .sort((a, b) => b.seat_index - a.seat_index);
      const toRemove = removable
        .slice(0, current - targetSeats)
        .map((r) => r.id);

      if (toRemove.length < current - targetSeats) {
        this.logger.warn(
          `Seat overage for ${userId}: target ${targetSeats} but ${current - toRemove.length} licenses remain (assigned rows are not deleted).`,
        );
      }

      if (toRemove.length > 0) {
        const { error: deleteError } = await client
          .from('device_licenses')
          .delete()
          .in('id', toRemove);
        if (deleteError) {
          throw new InternalServerErrorException(
            'Failed to remove device licenses',
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private assertStripeMode(customer: BillingCustomerRow): void {
    if (toBillingMode(customer.billing_mode) === 'manual') {
      throw new BadRequestException(MANUAL_MODE_MESSAGE);
    }
  }

  private async readSeatRows(
    client: SupabaseClient,
    userId: string,
  ): Promise<LicenseSeatRow[]> {
    const { data, error } = (await client
      .from('device_licenses')
      .select('id, seat_index, status, dev_eui, stripe_subscription_id')
      .eq('user_id', userId)
      .order('seat_index', { ascending: true })) as QueryResult<
      LicenseSeatRow[]
    >;
    if (error) {
      throw new InternalServerErrorException('Failed to read device licenses');
    }
    return data ?? [];
  }

  /**
   * Read an entire table in pages. PostgREST caps a single response at 1000
   * rows by default and `cw_device_owners` is already past that.
   */
  private async readAll<T>(
    client: SupabaseClient,
    table: string,
    columns: string,
  ): Promise<T[]> {
    const pageSize = 1000;
    const rows: T[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = (await client
        .from(table)
        .select(columns)
        .range(from, from + pageSize - 1)) as unknown as QueryResult<T[]>;
      if (error) {
        throw new InternalServerErrorException(`Failed to read ${table}`);
      }
      const page = data ?? [];
      rows.push(...page);
      if (page.length < pageSize) {
        return rows;
      }
    }
  }

  private async ensureBillingCustomer(
    client: SupabaseClient,
    userId: string,
  ): Promise<BillingCustomerRow> {
    const { data, error } = (await client
      .from('billing_customers')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()) as QueryResult<BillingCustomerRow>;
    if (error) {
      throw new InternalServerErrorException('Failed to read billing customer');
    }
    if (data) {
      return data;
    }

    const { data: inserted, error: insertError } = (await client
      .from('billing_customers')
      .upsert(
        { user_id: userId },
        { onConflict: 'user_id', ignoreDuplicates: false },
      )
      .select('*')
      .single()) as QueryResult<BillingCustomerRow>;
    if (insertError || !inserted) {
      throw new InternalServerErrorException(
        'Failed to create billing customer',
      );
    }
    return inserted;
  }

  /**
   * Ensure the user has a Stripe customer, creating one lazily on the first
   * billing action. Read paths (state page, portal) never create one.
   */
  private async ensureStripeCustomer(
    client: SupabaseClient,
    user: AuthenticatedUser,
  ): Promise<string> {
    const row = await this.ensureBillingCustomer(client, user.sub);
    if (row.stripe_customer_id) {
      return row.stripe_customer_id;
    }

    const customerId = await this.stripeService.createCustomer(
      user.sub,
      this.readEmail(user),
    );
    await this.patchBillingCustomer(client, user.sub, {
      stripe_customer_id: customerId,
    });
    return customerId;
  }

  private async linkCustomer(
    client: SupabaseClient,
    userId: string | null,
    stripeCustomerId: string | null,
  ): Promise<void> {
    if (!userId) {
      return;
    }
    const patch: Partial<BillingCustomerRow> = { user_id: userId };
    if (stripeCustomerId) {
      patch.stripe_customer_id = stripeCustomerId;
    }
    const { error } = await client
      .from('billing_customers')
      .upsert(
        { ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    if (error) {
      this.logger.warn(
        `Failed to link billing customer ${userId}: ${error.message}`,
      );
    }
  }

  private async patchBillingCustomer(
    client: SupabaseClient,
    userId: string,
    patch: Partial<BillingCustomerRow>,
  ): Promise<void> {
    const { error } = await client
      .from('billing_customers')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) {
      this.logger.warn(
        `Failed to update billing customer ${userId}: ${error.message}`,
      );
    }
  }

  private async patchBillingCustomerCache(
    client: SupabaseClient,
    userId: string,
    deviceSub: BillingSubscriptionInfo | null,
    reportingSub: BillingSubscriptionInfo | null,
  ): Promise<void> {
    await this.patchBillingCustomer(client, userId, {
      device_subscription_id: deviceSub?.id ?? null,
      device_seats: deviceSub ? this.effectiveSeats(deviceSub) : 0,
      reporting_subscription_id: reportingSub?.id ?? null,
      reporting_status: reportingSub?.status ?? null,
    });
  }

  /**
   * Best-effort: stop the CW-Reports cron from generating reports for a user
   * whose reporting add-on has ended. The user can re-enable templates after
   * re-subscribing (update() is entitlement-gated).
   */
  private async deactivateReportTemplates(
    client: SupabaseClient,
    userId: string,
  ): Promise<void> {
    const { error } = await client
      .from('cw_report_templates')
      .update({ is_active: false })
      .eq('created_by', userId);
    if (error) {
      this.logger.warn(
        `Failed to deactivate report templates for ${userId}: ${error.message}`,
      );
    }
  }

  private async listSubscriptionsSafe(
    stripeCustomerId: string | null,
  ): Promise<BillingSubscriptionInfo[]> {
    if (!stripeCustomerId) {
      return [];
    }
    try {
      return await this.stripeService.listSubscriptions(stripeCustomerId);
    } catch (error) {
      this.logger.warn(
        `Failed to list Stripe subscriptions for ${stripeCustomerId}: ${String(error)}`,
      );
      return [];
    }
  }

  private pickSubscription(
    subscriptions: BillingSubscriptionInfo[],
    priceId: string,
  ): BillingSubscriptionInfo | null {
    if (!priceId) {
      return null;
    }
    const matches = subscriptions.filter((s) => s.priceId === priceId);
    return (
      matches.find((s) => ACTIVE_SUBSCRIPTION_STATUSES.includes(s.status)) ??
      matches[0] ??
      null
    );
  }

  private effectiveSeats(subscription: BillingSubscriptionInfo): number {
    if (subscription.status === 'canceled') {
      return 0;
    }
    return subscription.seats ?? 0;
  }

  private requirePriceId(priceId: string, kind: string): string {
    if (!priceId) {
      throw new InternalServerErrorException(
        `Stripe ${kind} price id is not configured`,
      );
    }
    return priceId;
  }

  private readEmail(user: AuthenticatedUser): string | null {
    const email = user.email;
    return typeof email === 'string' && email.trim() ? email.trim() : null;
  }

  /** Unwrap Stripe's `string | object | null` expandable reference fields. */
  private readId(
    ref: string | { id: string } | null | undefined,
  ): string | null {
    if (!ref) {
      return null;
    }
    return typeof ref === 'string' ? ref : ref.id;
  }

  private async loadOwnedLicense(
    client: SupabaseClient,
    userId: string,
    licenseId: number,
  ): Promise<TableRow<'device_licenses'>> {
    const { data, error } = (await client
      .from('device_licenses')
      .select('*')
      .eq('id', licenseId)
      .eq('user_id', userId)
      .maybeSingle()) as QueryResult<DeviceLicenseRow>;
    if (error) {
      throw new InternalServerErrorException('Failed to read license');
    }
    if (!data) {
      throw new NotFoundException('License not found');
    }
    return data;
  }

  private async assertDeviceManageable(
    user: AuthenticatedUser,
    devEui: string,
  ): Promise<void> {
    const access = await this.accessService.getDeviceAccess(user, devEui);
    if (!access.exists || !decide(access, Action.DeviceEdit)) {
      throw new ForbiddenException('You do not manage this device');
    }
  }

  private async assertDeviceUnlicensed(
    client: SupabaseClient,
    devEui: string,
    exceptLicenseId: number,
  ): Promise<void> {
    const { data, error } = await client
      .from('device_licenses')
      .select('id')
      .eq('dev_eui', devEui)
      .neq('id', exceptLicenseId)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException('Failed to check device license');
    }
    if (data) {
      throw new ConflictException('That device already has a license.');
    }
  }

  private async setLicenseDevice(
    client: SupabaseClient,
    userId: string,
    licenseId: number,
    devEui: string,
  ): Promise<BillingLicense> {
    const { error } = await client
      .from('device_licenses')
      .update({
        dev_eui: devEui,
        status: 'assigned',
        updated_at: new Date().toISOString(),
      })
      .eq('id', licenseId)
      .eq('user_id', userId);
    if (error) {
      // Unique violation on dev_eui => device already licensed (race).
      if (error.code === '23505') {
        throw new ConflictException('That device already has a license.');
      }
      throw new InternalServerErrorException('Failed to assign license');
    }
    return this.fetchLicense(client, userId, licenseId);
  }

  /**
   * Remove every Stripe-backed license row for a user (used when the device
   * subscription ends). Staff-granted rows are left alone.
   */
  private async deleteStripeLicenses(
    client: SupabaseClient,
    userId: string,
  ): Promise<void> {
    const { error } = await client
      .from('device_licenses')
      .delete()
      .eq('user_id', userId)
      .not('stripe_subscription_id', 'is', null);
    if (error) {
      this.logger.warn(
        `Failed to delete device licenses for ${userId}: ${error.message}`,
      );
    }
  }

  private async fetchLicenses(
    client: SupabaseClient,
    userId: string,
  ): Promise<BillingLicense[]> {
    const { data, error } = await client
      .from('device_licenses')
      .select(
        'id, seat_index, status, dev_eui, stripe_subscription_id, cw_devices(name)',
      )
      .eq('user_id', userId)
      .order('seat_index', { ascending: true });
    if (error) {
      throw new InternalServerErrorException('Failed to read licenses');
    }
    return (data ?? []).map((row) => this.toLicense(row));
  }

  private async fetchLicense(
    client: SupabaseClient,
    userId: string,
    licenseId: number,
  ): Promise<BillingLicense> {
    const { data, error } = await client
      .from('device_licenses')
      .select(
        'id, seat_index, status, dev_eui, stripe_subscription_id, cw_devices(name)',
      )
      .eq('id', licenseId)
      .eq('user_id', userId)
      .single();
    if (error || !data) {
      throw new InternalServerErrorException('Failed to read license');
    }
    return this.toLicense(data);
  }

  private toLicense(row: {
    id: number;
    seat_index: number;
    status: string;
    dev_eui: string | null;
    stripe_subscription_id?: string | null;
    cw_devices?: { name: string | null } | { name: string | null }[] | null;
  }): BillingLicense {
    const device = Array.isArray(row.cw_devices)
      ? (row.cw_devices[0] ?? null)
      : (row.cw_devices ?? null);
    return {
      id: row.id,
      seatIndex: row.seat_index,
      status: row.status,
      devEui: row.dev_eui,
      deviceName: device?.name ?? null,
      manual: (row.stripe_subscription_id ?? null) === null,
    };
  }
}

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
import { MANAGE_CEILING } from '../common/permission-levels';
import type { TableInsert, TableRow } from '../types/supabase';
import { StripeService, BillingSubscriptionInfo } from './stripe.service';
import {
  BillingLicense,
  BillingProductsResponse,
  SubscriptionStateResponse,
} from './payments.types';
import type { AuthenticatedUser } from '../auth/authenticated-user';

type BillingCustomerRow = TableRow<'billing_customers'>;
type DeviceLicenseRow = TableRow<'device_licenses'>;
type LicenseSeatRow = Pick<
  DeviceLicenseRow,
  'id' | 'seat_index' | 'status' | 'dev_eui'
>;

/** Shape of a PostgREST response from the untyped Supabase client. */
type QueryResult<T> = { data: T | null; error: PostgrestError | null };

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly stripeService: StripeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async getProducts(): Promise<BillingProductsResponse> {
    const { basePriceId, devicePriceId } =
      await this.stripeService.resolvePriceIds();
    const products = await this.stripeService.listProducts([
      basePriceId,
      devicePriceId,
    ]);
    return {
      base: products.find((p) => p.id === basePriceId) ?? null,
      device: products.find((p) => p.id === devicePriceId) ?? null,
    };
  }

  async getState(user: AuthenticatedUser): Promise<SubscriptionStateResponse> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const customer = await this.ensureBillingCustomer(client, userId);

    const { basePriceId, devicePriceId } =
      await this.stripeService.resolvePriceIds();
    const subscriptions = await this.listSubscriptionsSafe(
      customer.stripe_customer_id,
    );
    const baseSub = this.pickSubscription(subscriptions, basePriceId);
    const deviceSub = this.pickSubscription(subscriptions, devicePriceId);

    // Keep the local license rows in sync with the paid seat count. The webhook
    // is the primary driver, but reconciling here makes the page self-healing
    // (e.g. in environments where webhooks aren't wired up yet).
    if (deviceSub) {
      const targetSeats = this.effectiveSeats(deviceSub);
      await this.reconcileSeats(client, userId, deviceSub.id, targetSeats);
    }

    await this.patchBillingCustomerCache(client, userId, baseSub, deviceSub);

    const licenses = await this.fetchLicenses(client, userId);
    const assignedCount = licenses.filter(
      (l) => l.status === 'assigned' && l.devEui,
    ).length;
    const seats = deviceSub ? this.effectiveSeats(deviceSub) : 0;

    return {
      base: {
        subscriptionId: baseSub?.id ?? null,
        status: baseSub?.status ?? null,
        discountId: baseSub?.discountId ?? null,
        currentPeriodEnd: baseSub?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: baseSub?.cancelAtPeriodEnd ?? false,
      },
      device: {
        subscriptionId: deviceSub?.id ?? null,
        seats,
        assignedCount,
        availableCount: Math.max(0, seats - assignedCount),
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
   * Whether the user has an active (or trialing / past-due) base subscription.
   * Stripe is the source of truth; if Stripe is unreachable we fall back to the
   * cached `billing_customers.base_status` so a transient outage doesn't block
   * a legitimately-subscribed user.
   */
  async hasActiveBaseSubscription(user: AuthenticatedUser): Promise<boolean> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const { data: row } = (await client
      .from('billing_customers')
      .select('stripe_customer_id, base_status')
      .eq('user_id', userId)
      .maybeSingle()) as QueryResult<
      Pick<BillingCustomerRow, 'stripe_customer_id' | 'base_status'>
    >;
    if (!row?.stripe_customer_id) {
      return false;
    }

    try {
      const { basePriceId } = await this.stripeService.resolvePriceIds();
      if (!basePriceId) {
        throw new Error('Stripe base price id could not be resolved');
      }
      const subscriptions = await this.stripeService.listSubscriptions(
        row.stripe_customer_id,
      );
      const baseSub = this.pickSubscription(subscriptions, basePriceId);
      return !!baseSub && ACTIVE_SUBSCRIPTION_STATUSES.includes(baseSub.status);
    } catch (error) {
      this.logger.warn(
        `Base-subscription check fell back to cache for ${userId}: ${String(error)}`,
      );
      return (
        !!row.base_status &&
        ACTIVE_SUBSCRIPTION_STATUSES.includes(row.base_status)
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Checkout / portal / cancel
  // ---------------------------------------------------------------------------

  async createBaseCheckout(
    user: AuthenticatedUser,
    discountId?: string | null,
  ): Promise<{ checkoutUrl: string }> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();
    const customerId = await this.ensureStripeCustomer(client, user);

    const { basePriceId } = await this.stripeService.resolvePriceIds();
    const subscriptions = await this.listSubscriptionsSafe(customerId);
    const existing = this.pickSubscription(subscriptions, basePriceId);
    if (existing && ACTIVE_SUBSCRIPTION_STATUSES.includes(existing.status)) {
      throw new ConflictException('A base subscription is already active.');
    }

    const checkoutUrl = await this.stripeService.createCheckout({
      priceId: this.requirePriceId(basePriceId, 'base'),
      customerId,
      userId,
      promotionCodeId: discountId ?? null,
    });
    return { checkoutUrl };
  }

  async createDeviceCheckout(
    user: AuthenticatedUser,
    quantity: number,
  ): Promise<{ checkoutUrl: string }> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();
    const customerId = await this.ensureStripeCustomer(client, user);

    const { devicePriceId } = await this.stripeService.resolvePriceIds();
    const subscriptions = await this.listSubscriptionsSafe(customerId);
    const existing = this.pickSubscription(subscriptions, devicePriceId);
    if (existing && ACTIVE_SUBSCRIPTION_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        'A device subscription already exists. Change the seat count instead.',
      );
    }

    const checkoutUrl = await this.stripeService.createCheckout({
      priceId: this.requirePriceId(devicePriceId, 'device'),
      customerId,
      userId,
      quantity,
      // Let the customer adjust the seat count on the hosted checkout page;
      // the final quantity is confirmed by webhook / getState reconcile.
      adjustableQuantity: true,
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

  async cancelBaseSubscription(
    user: AuthenticatedUser,
    atPeriodEnd: boolean,
  ): Promise<{ status: string }> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const customer = await this.ensureBillingCustomer(client, userId);
    const { basePriceId, devicePriceId } =
      await this.stripeService.resolvePriceIds();
    const subscriptions = await this.listSubscriptionsSafe(
      customer.stripe_customer_id,
    );
    const baseSub = this.pickSubscription(subscriptions, basePriceId);
    if (!baseSub) {
      throw new NotFoundException('No base subscription to cancel.');
    }

    const updated = await this.stripeService.cancelSubscription(
      baseSub.id,
      atPeriodEnd,
    );

    // The device subscription (all device licenses) cannot exist without the
    // base subscription, so cancel it with the same timing. The license rows are
    // torn down by the webhook when the subscription actually ends (immediately,
    // or at period end) — see applySubscriptionState.
    const deviceSub = this.pickSubscription(subscriptions, devicePriceId);
    if (deviceSub) {
      await this.stripeService.cancelSubscription(deviceSub.id, atPeriodEnd);
    }

    await this.patchBillingCustomer(client, userId, {
      base_status: updated.status,
    });
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
    const isGlobalUser = user.isStaff;
    const client = this.supabaseService.getClient();

    const license = await this.loadOwnedLicense(client, userId, licenseId);
    if (license.status === 'assigned' && license.dev_eui) {
      throw new ConflictException(
        'License is already assigned. Move it or unassign it first.',
      );
    }

    await this.assertDeviceManageable(client, userId, isGlobalUser, devEui);
    await this.assertDeviceUnlicensed(client, devEui, licenseId);

    return this.setLicenseDevice(client, userId, licenseId, devEui);
  }

  async moveLicense(
    user: AuthenticatedUser,
    licenseId: number,
    devEui: string,
  ): Promise<BillingLicense> {
    const userId = user.sub;
    const isGlobalUser = user.isStaff;
    const client = this.supabaseService.getClient();

    await this.loadOwnedLicense(client, userId, licenseId);
    await this.assertDeviceManageable(client, userId, isGlobalUser, devEui);
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
   * Cancel a single UNASSIGNED license: drops the paid seat count by one (or
   * cancels the device subscription outright when it's the last seat, since
   * the seat minimum is 1). Assigned licenses must be unassigned first.
   */
  async cancelLicense(
    user: AuthenticatedUser,
    licenseId: number,
  ): Promise<{ canceled: boolean }> {
    const userId = user.sub;
    const client = this.supabaseService.getClient();

    const license = await this.loadOwnedLicense(client, userId, licenseId);
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

    const target = (await this.fetchLicenses(client, userId)).length - 1;
    if (target >= 1) {
      await this.stripeService.updateSeats(deviceSub.id, target);
    } else {
      // Last seat: cancel the device subscription instead of going to 0 seats.
      await this.stripeService.cancelSubscription(deviceSub.id, false);
      await this.patchBillingCustomer(client, userId, {
        device_subscription_id: null,
        device_seats: 0,
      });
    }

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
        await this.linkCustomer(
          client,
          session.client_reference_id ?? null,
          customerId,
        );
        // Converge subscription state immediately in case the
        // customer.subscription.* events arrived first (or are delayed).
        const subscriptionId = this.readId(session.subscription);
        if (subscriptionId && session.client_reference_id && customerId) {
          const info = await this.fetchSubscriptionInfo(subscriptionId, null);
          if (info) {
            await this.applySubscriptionState(
              client,
              session.client_reference_id,
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

    const { basePriceId, devicePriceId } =
      await this.stripeService.resolvePriceIds();

    if (basePriceId && subscription.priceId === basePriceId) {
      if (isDeleted) {
        await this.patchBillingCustomer(client, userId, {
          base_subscription_id: null,
          base_status: 'canceled',
          base_discount_id: null,
        });
        return;
      }
      await this.patchBillingCustomer(client, userId, {
        base_subscription_id: subscription.id,
        base_status: subscription.status,
        base_discount_id: subscription.discountId,
      });
      return;
    }

    if (devicePriceId && subscription.priceId === devicePriceId) {
      // Deleted (or status 'canceled') = access has actually ended — either an
      // immediate cancel or a scheduled cancel reaching period end. Tear down
      // EVERY license, assigned or not. A still-scheduled cancel
      // (cancel_at_period_end=true while status stays 'active') keeps the seats
      // live, so we fall through and reconcile to the current paid seat count.
      if (isDeleted || subscription.status === 'canceled') {
        await this.deleteAllLicenses(client, userId);
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
   * Resolve which CropWatch user a webhook subscription belongs to:
   * subscription metadata first, then the local customer mapping, then the
   * Stripe customer's metadata.
   */
  private async resolveWebhookUserId(
    client: SupabaseClient,
    subscription: Stripe.Subscription,
    customerId: string | null,
  ): Promise<string | null> {
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
  // Seat reconciliation — converge license rows to the paid seat count.
  // Idempotent: only ever inserts unassigned rows or deletes unassigned rows.
  // Assigned rows are never destroyed here (the API blocks decreases below the
  // assigned count); an unsatisfiable decrease is logged as an overage.
  // ---------------------------------------------------------------------------

  private async reconcileSeats(
    client: SupabaseClient,
    userId: string,
    subscriptionId: string,
    targetSeats: number,
  ): Promise<void> {
    const { data, error } = (await client
      .from('device_licenses')
      .select('id, seat_index, status, dev_eui')
      .eq('user_id', userId)
      .order('seat_index', { ascending: true })) as QueryResult<
      LicenseSeatRow[]
    >;
    if (error) {
      throw new InternalServerErrorException('Failed to read device licenses');
    }

    const rows = data ?? [];
    const current = rows.length;

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
        throw new InternalServerErrorException('Failed to add device licenses');
      }
      return;
    }

    if (targetSeats < current) {
      const removable = rows
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
    baseSub: BillingSubscriptionInfo | null,
    deviceSub: BillingSubscriptionInfo | null,
  ): Promise<void> {
    await this.patchBillingCustomer(client, userId, {
      base_subscription_id: baseSub?.id ?? null,
      base_status: baseSub?.status ?? null,
      base_discount_id: baseSub?.discountId ?? null,
      device_subscription_id: deviceSub?.id ?? null,
      device_seats: deviceSub ? this.effectiveSeats(deviceSub) : 0,
    });
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
    client: SupabaseClient,
    userId: string,
    isGlobalUser: boolean,
    devEui: string,
  ): Promise<void> {
    let query = client
      .from('cw_devices')
      .select('dev_eui, owner_match:cw_device_owners()')
      .eq('dev_eui', devEui);

    if (!isGlobalUser) {
      query = query
        .eq('owner_match.user_id', userId)
        .lte('owner_match.permission_level', MANAGE_CEILING)
        .or(`user_id.eq.${userId},owner_match.not.is.null`);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new InternalServerErrorException('Failed to verify device access');
    }
    if (!data) {
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

  /** Remove every license row for a user (used when the device sub ends). */
  private async deleteAllLicenses(
    client: SupabaseClient,
    userId: string,
  ): Promise<void> {
    const { error } = await client
      .from('device_licenses')
      .delete()
      .eq('user_id', userId);
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
      .select('id, seat_index, status, dev_eui, cw_devices(name)')
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
      .select('id, seat_index, status, dev_eui, cw_devices(name)')
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
    };
  }
}

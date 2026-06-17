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
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  getAccessToken,
  getUserId,
  isCropwatchStaff,
} from '../../supabase/supabase-token.helper';
import { MANAGE_CEILING } from '../common/permission-levels';
import type { TableInsert, TableRow } from '../types/supabase';
import {
  PolarService,
  PolarSubscriptionInfo,
  WebhookVerificationError,
} from './polar.service';
import {
  BillingLicense,
  BillingProductsResponse,
  SubscriptionStateResponse,
} from './payments.types';

type BillingCustomerRow = TableRow<'billing_customers'>;

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly polarService: PolarService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async getProducts(): Promise<BillingProductsResponse> {
    const products = await this.polarService.listProducts([
      this.polarService.baseProductId,
      this.polarService.deviceProductId,
    ]);
    return {
      base: products.find((p) => p.id === this.polarService.baseProductId) ?? null,
      device:
        products.find((p) => p.id === this.polarService.deviceProductId) ?? null,
    };
  }

  async getState(
    jwtPayload: any,
    authHeader: string,
  ): Promise<SubscriptionStateResponse> {
    const userId = getUserId(jwtPayload);
    const client = this.supabaseService.getClient(getAccessToken(authHeader));

    await this.ensureBillingCustomer(client, userId);

    const subscriptions = await this.listSubscriptionsSafe(userId);
    const baseSub = this.pickSubscription(subscriptions, this.polarService.baseProductId);
    const deviceSub = this.pickSubscription(
      subscriptions,
      this.polarService.deviceProductId,
    );

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

  async getLicenses(jwtPayload: any, authHeader: string): Promise<BillingLicense[]> {
    const userId = getUserId(jwtPayload);
    const client = this.supabaseService.getClient(getAccessToken(authHeader));
    return this.fetchLicenses(client, userId);
  }

  /**
   * Whether the user has an active (or trialing / past-due) base subscription.
   * Polar is the source of truth; if Polar is unreachable we fall back to the
   * cached `billing_customers.base_status` so a transient outage doesn't block
   * a legitimately-subscribed user.
   */
  async hasActiveBaseSubscription(jwtPayload: any, authHeader: string): Promise<boolean> {
    const userId = getUserId(jwtPayload);
    try {
      const subscriptions = await this.polarService.listSubscriptions(userId);
      const baseSub = this.pickSubscription(subscriptions, this.polarService.baseProductId);
      return !!baseSub && ACTIVE_SUBSCRIPTION_STATUSES.includes(baseSub.status);
    } catch (error) {
      this.logger.warn(
        `Base-subscription check fell back to cache for ${userId}: ${error}`,
      );
      const client = this.supabaseService.getClient(getAccessToken(authHeader));
      const { data } = await client
        .from('billing_customers')
        .select('base_status')
        .eq('user_id', userId)
        .maybeSingle();
      return (
        !!data?.base_status && ACTIVE_SUBSCRIPTION_STATUSES.includes(data.base_status)
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Checkout / portal / cancel
  // ---------------------------------------------------------------------------

  async createBaseCheckout(
    jwtPayload: any,
    authHeader: string,
    discountId?: string | null,
  ): Promise<{ checkoutUrl: string }> {
    const userId = getUserId(jwtPayload);
    const client = this.supabaseService.getClient(getAccessToken(authHeader));
    await this.ensureBillingCustomer(client, userId);

    const subscriptions = await this.listSubscriptionsSafe(userId);
    const existing = this.pickSubscription(subscriptions, this.polarService.baseProductId);
    if (existing && ACTIVE_SUBSCRIPTION_STATUSES.includes(existing.status)) {
      throw new ConflictException('A base subscription is already active.');
    }

    const checkoutUrl = await this.polarService.createCheckout({
      productId: this.requireProductId(this.polarService.baseProductId, 'base'),
      externalCustomerId: userId,
      customerEmail: this.readEmail(jwtPayload),
      discountId: discountId ?? null,
    });
    return { checkoutUrl };
  }

  async createDeviceCheckout(
    jwtPayload: any,
    authHeader: string,
    quantity: number,
  ): Promise<{ checkoutUrl: string }> {
    const userId = getUserId(jwtPayload);
    const client = this.supabaseService.getClient(getAccessToken(authHeader));
    await this.ensureBillingCustomer(client, userId);

    const subscriptions = await this.listSubscriptionsSafe(userId);
    const existing = this.pickSubscription(subscriptions, this.polarService.deviceProductId);
    if (existing && ACTIVE_SUBSCRIPTION_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        'A device subscription already exists. Change the seat count instead.',
      );
    }

    const checkoutUrl = await this.polarService.createCheckout({
      productId: this.requireProductId(this.polarService.deviceProductId, 'device'),
      externalCustomerId: userId,
      customerEmail: this.readEmail(jwtPayload),
      // Informational: the seat count is confirmed by Polar (webhook / getState
      // reconcile). Honoured on the hosted checkout's seat selector.
      metadata: { seats: quantity },
    });
    return { checkoutUrl };
  }

  async changeDeviceSeats(
    jwtPayload: any,
    authHeader: string,
    seats: number,
  ): Promise<{ seats: number }> {
    const userId = getUserId(jwtPayload);
    const client = this.supabaseService.getClient(getAccessToken(authHeader));

    const subscriptions = await this.listSubscriptionsSafe(userId);
    const deviceSub = this.pickSubscription(
      subscriptions,
      this.polarService.deviceProductId,
    );
    if (!deviceSub) {
      throw new BadRequestException(
        'No device subscription yet. Purchase device licenses first.',
      );
    }

    const licenses = await this.fetchLicenses(client, userId);
    const assigned = licenses.filter((l) => l.status === 'assigned' && l.devEui);
    if (seats < assigned.length) {
      const names = assigned
        .map((l) => l.deviceName ?? l.devEui)
        .filter(Boolean)
        .join(', ');
      throw new ConflictException(
        `Cannot reduce to ${seats} licenses: ${assigned.length} are assigned. Unassign first (${names}).`,
      );
    }

    await this.polarService.updateSeats(deviceSub.id, seats);
    // Optimistic local sync; the subscription.updated webhook will confirm.
    await this.reconcileSeats(client, userId, deviceSub.id, seats);
    return { seats };
  }

  async openPortal(
    jwtPayload: any,
    authHeader: string,
  ): Promise<{ portalUrl: string }> {
    const userId = getUserId(jwtPayload);
    getAccessToken(authHeader); // validate bearer token shape
    try {
      const portalUrl = await this.polarService.createPortalSession(userId);
      return { portalUrl };
    } catch (error) {
      this.logger.warn(`Failed to open Polar portal for ${userId}: ${error}`);
      throw new BadRequestException(
        'No billing account yet. Subscribe before opening the billing portal.',
      );
    }
  }

  async cancelBaseSubscription(
    jwtPayload: any,
    authHeader: string,
    atPeriodEnd: boolean,
  ): Promise<{ status: string }> {
    const userId = getUserId(jwtPayload);
    const client = this.supabaseService.getClient(getAccessToken(authHeader));

    const subscriptions = await this.listSubscriptionsSafe(userId);
    const baseSub = this.pickSubscription(subscriptions, this.polarService.baseProductId);
    if (!baseSub) {
      throw new NotFoundException('No base subscription to cancel.');
    }

    const updated = await this.polarService.cancelSubscription(baseSub.id, atPeriodEnd);

    // The device subscription (all device licenses) cannot exist without the
    // base subscription, so cancel it with the same timing. The license rows are
    // torn down by the webhook when the subscription is actually revoked
    // (immediately, or at period end) — see handleSubscriptionEvent.
    const deviceSub = this.pickSubscription(
      subscriptions,
      this.polarService.deviceProductId,
    );
    if (deviceSub) {
      await this.polarService.cancelSubscription(deviceSub.id, atPeriodEnd);
    }

    await this.patchBillingCustomer(client, userId, {
      base_status: updated.status,
    });
    return { status: atPeriodEnd ? 'canceling' : 'canceled' };
  }

  // ---------------------------------------------------------------------------
  // License assignment (CropWatch-owned; no Polar calls)
  // ---------------------------------------------------------------------------

  async assignLicense(
    jwtPayload: any,
    authHeader: string,
    licenseId: number,
    devEui: string,
  ): Promise<BillingLicense> {
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
    const client = this.supabaseService.getClient(getAccessToken(authHeader));

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
    jwtPayload: any,
    authHeader: string,
    licenseId: number,
    devEui: string,
  ): Promise<BillingLicense> {
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
    const client = this.supabaseService.getClient(getAccessToken(authHeader));

    await this.loadOwnedLicense(client, userId, licenseId);
    await this.assertDeviceManageable(client, userId, isGlobalUser, devEui);
    await this.assertDeviceUnlicensed(client, devEui, licenseId);

    return this.setLicenseDevice(client, userId, licenseId, devEui);
  }

  async unassignLicense(
    jwtPayload: any,
    authHeader: string,
    licenseId: number,
  ): Promise<BillingLicense> {
    const userId = getUserId(jwtPayload);
    const client = this.supabaseService.getClient(getAccessToken(authHeader));

    await this.loadOwnedLicense(client, userId, licenseId);

    const { error } = await client
      .from('device_licenses')
      .update({ dev_eui: null, status: 'unassigned', updated_at: new Date().toISOString() })
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
   * Polar's seat minimum is 1). Assigned licenses must be unassigned first.
   */
  async cancelLicense(
    jwtPayload: any,
    authHeader: string,
    licenseId: number,
  ): Promise<{ canceled: boolean }> {
    const userId = getUserId(jwtPayload);
    const client = this.supabaseService.getClient(getAccessToken(authHeader));

    const license = await this.loadOwnedLicense(client, userId, licenseId);
    if (license.dev_eui || license.status === 'assigned') {
      throw new ConflictException(
        'Only unassigned licenses can be canceled. Unassign it from its device first.',
      );
    }

    const subscriptions = await this.listSubscriptionsSafe(userId);
    const deviceSub = this.pickSubscription(
      subscriptions,
      this.polarService.deviceProductId,
    );
    if (!deviceSub) {
      throw new BadRequestException('No device subscription found.');
    }

    const target = (await this.fetchLicenses(client, userId)).length - 1;
    if (target >= 1) {
      await this.polarService.updateSeats(deviceSub.id, target);
    } else {
      // Last seat: Polar can't go to 0 seats, so cancel the subscription.
      await this.polarService.cancelSubscription(deviceSub.id, false);
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
    if (!this.polarService.isWebhookConfigured) {
      this.logger.error(
        'POLAR_WEBHOOK_SECRET is not configured — rejecting Polar webhook',
      );
      throw new UnauthorizedException('Polar webhook is not configured');
    }

    let event: ReturnType<PolarService['validateWebhook']>;
    try {
      event = this.polarService.validateWebhook(rawBody, headers);
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        throw new ForbiddenException('Invalid Polar webhook signature');
      }
      throw error;
    }

    const client = this.supabaseService.getAdminClient();

    switch (event.type) {
      case 'subscription.created':
      case 'subscription.active':
      case 'subscription.updated':
      case 'subscription.uncanceled':
      case 'subscription.canceled':
      case 'subscription.revoked':
        await this.handleSubscriptionEvent(client, event.data, event.type);
        break;
      case 'order.paid':
        await this.linkCustomer(
          client,
          event.data.customer?.externalId ?? null,
          event.data.customerId ?? null,
        );
        break;
      case 'checkout.updated':
        await this.linkCustomer(
          client,
          event.data.externalCustomerId ?? null,
          event.data.customerId ?? null,
        );
        break;
      case 'customer.created':
      case 'customer.updated':
        await this.linkCustomer(
          client,
          event.data.externalId ?? null,
          event.data.id ?? null,
        );
        break;
      default:
        // Other events are not relevant to billing state.
        break;
    }

    return { received: true };
  }

  private async handleSubscriptionEvent(
    client: SupabaseClient,
    subscription: {
      id: string;
      productId: string;
      status: string;
      seats?: number | null;
      discountId: string | null;
      customerId: string;
      customer: { externalId?: string | null };
    },
    eventType: string,
  ): Promise<void> {
    const userId = subscription.customer?.externalId ?? null;
    if (!userId) {
      this.logger.warn(
        `Polar ${eventType} for subscription ${subscription.id} has no customer external id — skipping`,
      );
      return;
    }

    await this.linkCustomer(client, userId, subscription.customerId ?? null);

    if (subscription.productId === this.polarService.baseProductId) {
      await this.patchBillingCustomer(client, userId, {
        base_subscription_id: subscription.id,
        base_status: subscription.status,
        base_discount_id: subscription.discountId,
      });
      return;
    }

    if (subscription.productId === this.polarService.deviceProductId) {
      // 'revoked' (or status 'canceled') = access has actually ended — either an
      // immediate revoke or a scheduled cancel reaching period end. Tear down
      // EVERY license, assigned or not. A still-scheduled cancel
      // ('subscription.canceled' while status stays 'active') keeps the seats
      // live, so we fall through and reconcile to the current paid seat count.
      if (eventType === 'subscription.revoked' || subscription.status === 'canceled') {
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
    const { data, error } = await client
      .from('device_licenses')
      .select('id, seat_index, status, dev_eui')
      .eq('user_id', userId)
      .order('seat_index', { ascending: true });
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
          polar_subscription_id: subscriptionId,
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
      const toRemove = removable.slice(0, current - targetSeats).map((r) => r.id);

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
          throw new InternalServerErrorException('Failed to remove device licenses');
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
    const { data, error } = await client
      .from('billing_customers')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException('Failed to read billing customer');
    }
    if (data) {
      return data;
    }

    const { data: inserted, error: insertError } = await client
      .from('billing_customers')
      .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: false })
      .select('*')
      .single();
    if (insertError || !inserted) {
      throw new InternalServerErrorException('Failed to create billing customer');
    }
    return inserted;
  }

  private async linkCustomer(
    client: SupabaseClient,
    userId: string | null,
    polarCustomerId: string | null,
  ): Promise<void> {
    if (!userId) {
      return;
    }
    const patch: Partial<BillingCustomerRow> = { user_id: userId };
    if (polarCustomerId) {
      patch.polar_customer_id = polarCustomerId;
    }
    const { error } = await client
      .from('billing_customers')
      .upsert(
        { ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    if (error) {
      this.logger.warn(`Failed to link billing customer ${userId}: ${error.message}`);
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
    baseSub: PolarSubscriptionInfo | null,
    deviceSub: PolarSubscriptionInfo | null,
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
    userId: string,
  ): Promise<PolarSubscriptionInfo[]> {
    try {
      return await this.polarService.listSubscriptions(userId);
    } catch (error) {
      this.logger.warn(`Failed to list Polar subscriptions for ${userId}: ${error}`);
      return [];
    }
  }

  private pickSubscription(
    subscriptions: PolarSubscriptionInfo[],
    productId: string,
  ): PolarSubscriptionInfo | null {
    if (!productId) {
      return null;
    }
    const matches = subscriptions.filter((s) => s.productId === productId);
    return (
      matches.find((s) => ACTIVE_SUBSCRIPTION_STATUSES.includes(s.status)) ??
      matches[0] ??
      null
    );
  }

  private effectiveSeats(subscription: PolarSubscriptionInfo): number {
    if (subscription.status === 'canceled') {
      return 0;
    }
    return subscription.seats ?? 0;
  }

  private requireProductId(productId: string, kind: string): string {
    if (!productId) {
      throw new InternalServerErrorException(
        `Polar ${kind} product id is not configured`,
      );
    }
    return productId;
  }

  private readEmail(jwtPayload: any): string | null {
    const email = jwtPayload?.email;
    return typeof email === 'string' && email.trim() ? email.trim() : null;
  }

  private async loadOwnedLicense(
    client: SupabaseClient,
    userId: string,
    licenseId: number,
  ): Promise<TableRow<'device_licenses'>> {
    const { data, error } = await client
      .from('device_licenses')
      .select('*')
      .eq('id', licenseId)
      .eq('user_id', userId)
      .maybeSingle();
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

  /** Remove every license row for a user (used when the device sub is revoked). */
  private async deleteAllLicenses(
    client: SupabaseClient,
    userId: string,
  ): Promise<void> {
    const { error } = await client
      .from('device_licenses')
      .delete()
      .eq('user_id', userId);
    if (error) {
      this.logger.warn(`Failed to delete device licenses for ${userId}: ${error.message}`);
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
      ? row.cw_devices[0] ?? null
      : row.cw_devices ?? null;
    return {
      id: row.id,
      seatIndex: row.seat_index,
      status: row.status,
      devEui: row.dev_eui,
      deviceName: device?.name ?? null,
    };
  }
}

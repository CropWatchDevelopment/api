import { BillingProductInfo } from './stripe.service';

/**
 * A device subscription must always carry at least this many seats. Enforced
 * on the hosted checkout (adjustable_quantity.minimum), on seat changes, and
 * on per-seat cancellation; going lower means canceling the subscription.
 */
export const SEAT_MINIMUM = 3;

/**
 * How a customer pays.
 *  - `stripe`: self-serve subscriptions via Stripe Checkout (default).
 *  - `manual`: invoiced outside Stripe; seats and reporting are granted by
 *    CropWatch staff (device_licenses rows with a NULL subscription id).
 */
export type BillingMode = 'stripe' | 'manual';

/** A single device license (one seat) and its current device assignment. */
export interface BillingLicense {
  id: number;
  seatIndex: number;
  status: string; // 'assigned' | 'unassigned'
  devEui: string | null;
  deviceName: string | null;
  /** True when the seat was granted by staff (not backed by a Stripe subscription). */
  manual: boolean;
}

export interface DeviceSubscriptionState {
  subscriptionId: string | null;
  status: string | null; // active | trialing | past_due | canceled | null
  seats: number; // paid (or staff-granted) licenses
  minimumSeats: number; // SEAT_MINIMUM
  assignedCount: number; // licenses currently attached to a device
  availableCount: number; // seats - assignedCount
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface ReportingSubscriptionState {
  subscriptionId: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Whether the user may create/edit/regenerate reports right now. */
  entitled: boolean;
  /** True when the entitlement was granted by staff rather than Stripe. */
  manual: boolean;
}

/** The full billing overview returned to the account/billing page. */
export interface SubscriptionStateResponse {
  billingMode: BillingMode;
  device: DeviceSubscriptionState;
  reporting: ReportingSubscriptionState;
  licenses: BillingLicense[];
}

export interface BillingProductsResponse {
  device: BillingProductInfo | null;
  reporting: BillingProductInfo | null;
}

/**
 * Cheap, DB-only entitlement summary for pages that just need to know what
 * the user may do (e.g. the reports pages). Never calls Stripe.
 */
export interface BillingEntitlementsResponse {
  billingMode: BillingMode;
  isStaff: boolean;
  seats: number;
  reporting: boolean;
}

/** One row of the staff billing overview (`GET /payments/admin/customers`). */
export interface AdminBillingCustomer {
  userId: string;
  email: string | null;
  fullName: string | null;
  billingMode: BillingMode;
  /** Devices this user owns (cw_devices.user_id, else their admin-level owner row). */
  deviceCount: number;
  /** Of those devices, how many carry a license (from any user). */
  licensedDeviceCount: number;
  /** Total license rows owned by this user. */
  seatCount: number;
  /** License rows granted by staff (NULL subscription id). */
  manualSeatCount: number;
  stripeCustomerId: string | null;
  deviceSubscriptionId: string | null;
  deviceSeats: number;
  reportingStatus: string | null;
  reportingManual: boolean;
}

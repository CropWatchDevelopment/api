import { PolarProductInfo } from './polar.service';

/** A single device license (one paid seat) and its current device assignment. */
export interface BillingLicense {
  id: number;
  seatIndex: number;
  status: string; // 'assigned' | 'unassigned'
  devEui: string | null;
  deviceName: string | null;
}

export interface BaseSubscriptionState {
  subscriptionId: string | null;
  status: string | null; // active | trialing | past_due | canceled | null
  discountId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface DeviceSubscriptionState {
  subscriptionId: string | null;
  seats: number; // paid licenses
  assignedCount: number; // licenses currently attached to a device
  availableCount: number; // seats - assignedCount
}

/** The full billing overview returned to the account/billing page. */
export interface SubscriptionStateResponse {
  base: BaseSubscriptionState;
  device: DeviceSubscriptionState;
  licenses: BillingLicense[];
}

export interface BillingProductsResponse {
  base: PolarProductInfo | null;
  device: PolarProductInfo | null;
}

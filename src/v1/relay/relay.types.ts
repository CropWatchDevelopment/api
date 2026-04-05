import type { TableRow } from '../../v1/types/supabase';

export type RelayNumber = 1 | 2;
export type RelayTargetState = 'off' | 'on';
export type RelayDataRow = TableRow<'cw_relay_data'>;

export interface RelayConfirmation {
  devEui: string;
  receivedAt: string;
  relay1: boolean | null;
  relay2: boolean | null;
}

export function isRelayNumber(value: unknown): value is RelayNumber {
  return value === 1 || value === 2;
}

export function isRelayTargetState(value: unknown): value is RelayTargetState {
  return value === 'off' || value === 'on';
}

export function getRelayState(
  row: Pick<RelayDataRow, 'relay_1' | 'relay_2'> | null | undefined,
  relay: RelayNumber,
): boolean | null {
  if (!row) {
    return null;
  }

  return relay === 1 ? row.relay_1 : row.relay_2;
}
